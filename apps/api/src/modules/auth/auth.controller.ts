import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { otpRequestSchema, otpVerifySchema, refreshSchema } from "@medpass/validation";
import { ERROR_CODES } from "@medpass/domain";
import { env } from "../../common/env";
import { parseWith } from "../../common/zod";
import { ApiProblem } from "../../common/errors";
import { Public, SESSION_COOKIE } from "../../common/auth.guard";
import { RateLimit } from "../../common/rate-limit.guard";
import { verifyTurnstile } from "../../common/turnstile";
import type { ApiRequest } from "../../common/http";
import { computeProfileRelationships } from "../../common/profile-relationship";
import { AuthService, type IssuedSession } from "./auth.service";
import { PrismaService } from "../../common/prisma.service";

const REFRESH_COOKIE = "medpass_refresh";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Lets the PWA show accurate delivery-channel wording ("we'll call you"
   * vs "we've texted you") instead of defaulting to the SMS assumption
   * most patients otherwise bring to an OTP screen — a real point of
   * confusion once voice became this environment's actual OTP transport.
   */
  @Public()
  @Get("otp-transport")
  otpTransport() {
    return { transport: env().OTP_TRANSPORT };
  }

  @Public()
  @RateLimit({ name: "otp_request", limit: 10, windowSeconds: 3600 })
  @Post("otp/request")
  @HttpCode(202)
  async requestOtp(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(otpRequestSchema, body);
    // Covers both "login" and "recovery" purposes (docs/26 §12.4) — recovery
    // shares this same endpoint, not a separate one.
    if (!(await verifyTurnstile(env().TURNSTILE_SECRET_KEY, input.turnstileToken, req.ip))) {
      throw new ApiProblem(ERROR_CODES.TURNSTILE_FAILED, "Verification failed. Please try again.", 400);
    }
    await this.auth.requestOtp(input, req.ip, req.correlationId);
    // Enumeration-safe: same response whether or not the number exists.
    return { message: "If this number can receive codes, one has been sent." };
  }

  @Public()
  @RateLimit({ name: "otp_verify", limit: 20, windowSeconds: 3600 })
  @Post("otp/verify")
  async verifyOtp(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const input = parseWith(otpVerifySchema, body);
    const session = await this.auth.verifyOtp(input, req.correlationId);
    this.setSessionCookies(res, session);
    return this.sessionResponse(session);
  }

  @Public()
  @Post("refresh")
  async refresh(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const cookieRefresh = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    const input = cookieRefresh ? { refreshToken: cookieRefresh } : parseWith(refreshSchema, body);
    const session = await this.auth.refresh(input.refreshToken, req.correlationId);
    this.setSessionCookies(res, session);
    return this.sessionResponse(session);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeSession(req.auth!.userId, req.auth!.sessionId, "logout", req.correlationId);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(REFRESH_COOKIE, { path: "/v1/auth" });
  }

  @Get("sessions")
  async sessions(@Req() req: ApiRequest) {
    const items = await this.auth.listSessions(req.auth!.userId);
    return { items: items.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })) };
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async revokeSession(@Param("id") id: string, @Req() req: ApiRequest) {
    await this.auth.revokeSession(req.auth!.userId, id, "user_revoked", req.correlationId);
  }

  private setSessionCookies(res: Response, session: IssuedSession): void {
    const secure = env().NODE_ENV === "production" || env().NODE_ENV === "staging";
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      // Refresh token is only ever sent to the auth endpoints.
      path: "/v1/auth",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }

  private async sessionResponse(session: IssuedSession) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    const profiles = await this.prisma.patientProfile.findMany({
      where: {
        deletedAt: null,
        OR: [
          { ownerUserId: session.userId },
          { claimedByUserId: session.userId },
          {
            caregiverRelationships: {
              some: { caregiverUserId: session.userId, status: "active" },
            },
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    const relationships = computeProfileRelationships(profiles, session.userId);
    return {
      user: { id: user.id, preferredLocale: user.preferredLocale },
      // Native clients read the bearer token; web relies on the cookie.
      token: session.token,
      profiles: profiles.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        relationship: relationships.get(p.id)!,
        rowVersion: p.rowVersion,
      })),
    };
  }
}
