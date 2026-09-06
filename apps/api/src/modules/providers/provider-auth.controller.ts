import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ERROR_CODES } from "@medpass/domain";
import { providerLoginSchema, providerTotpSchema } from "@medpass/validation";
import { env } from "../../common/env";
import { ApiProblem } from "../../common/errors";
import { Public } from "../../common/auth.guard";
import { RateLimit } from "../../common/rate-limit.guard";
import { verifyTurnstile } from "../../common/turnstile";
import { parseWith } from "../../common/zod";
import type { ApiRequest } from "../../common/http";
import { ProviderAuthService } from "./provider-auth.service";
import { ProviderGuard } from "./provider.guard";
import { PROVIDER_SESSION_COOKIE } from "./provider-session";

/**
 * Provider-portal sign-in (docs_v2/05 §11). `@Public()` skips the *patient*
 * AuthGuard only; `ProviderGuard` is the real check on the routes that
 * need a session. Same cookie/bearer conventions as the other surfaces,
 * different cookie name, different token type.
 */
@Public()
@Controller("provider/auth")
export class ProviderAuthController {
  constructor(private readonly providerAuth: ProviderAuthService) {}

  /** Step one of phone-OTP sign-in. Enumeration-safe: the reply never says whether the number is a provider. */
  @RateLimit({ name: "provider_login", limit: 10, windowSeconds: 3600 })
  @Post("login")
  @HttpCode(202)
  async login(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(providerLoginSchema, body);
    if (!(await verifyTurnstile(env().TURNSTILE_SECRET_KEY, input.turnstileToken, req.ip))) {
      throw new ApiProblem(ERROR_CODES.TURNSTILE_FAILED, "Verification failed. Please try again.", 400);
    }
    await this.providerAuth.requestLogin(input, req.ip, req.correlationId);
    return { message: "If this number can receive codes, one has been sent.", method: "phone_otp" };
  }

  /** Step two: the one-time code. Issues a provider session (never a patient one). */
  @RateLimit({ name: "provider_totp", limit: 20, windowSeconds: 3600 })
  @Post("totp")
  async totp(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const input = parseWith(providerTotpSchema, body);
    const session = await this.providerAuth.verify(input, req.correlationId);
    const secure = env().NODE_ENV === "production" || env().NODE_ENV === "staging";
    res.cookie(PROVIDER_SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    return {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: { id: session.userId },
      organizations: session.organizations,
    };
  }

  @UseGuards(ProviderGuard)
  @Get("session")
  async session(@Req() req: ApiRequest) {
    const me = await this.providerAuth.me(req.providerAuth!.userId);
    return { ...me, current: { organizationId: req.providerAuth!.organizationId, role: req.providerAuth!.role } };
  }

  @UseGuards(ProviderGuard)
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    await this.providerAuth.logout(req.providerAuth!.userId, req.providerAuth!.sessionId, req.correlationId);
    res.clearCookie(PROVIDER_SESSION_COOKIE, { path: "/" });
  }
}
