import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { deviceLoginSchema, otpRequestSchema, otpVerifySchema, refreshSchema } from "@medpass/validation";
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
const DEVICE_TRUST_COOKIE = "medpass_device_trust";

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
    const incomingTrustToken = (req.cookies as Record<string, string> | undefined)?.[DEVICE_TRUST_COOKIE];
    const session = await this.auth.verifyOtp(input, incomingTrustToken, req.correlationId);
    this.setSessionCookies(res, session);
    // No token in the response means "remember this device" was unchecked
    // (or was explicitly cleared) this time — drop any stale cookie rather
    // than leave a credential in the browser that no longer resolves.
    if (session.deviceTrustToken) this.setDeviceTrustCookie(res, session.deviceTrustToken);
    else res.clearCookie(DEVICE_TRUST_COOKIE, { path: "/v1/auth" });
    return this.sessionResponse(session);
  }

  /**
   * Silent phone-only login for a previously-remembered device (docs/24
   * ADR-14) — no OTP, no Turnstile (no SMS/call is ever sent, so that abuse
   * vector doesn't apply; the real security boundary is possession of the
   * unguessable httpOnly trust cookie).
   */
  @Public()
  @RateLimit({ name: "device_login", limit: 20, windowSeconds: 3600 })
  @Post("device-login")
  async deviceLogin(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const input = parseWith(deviceLoginSchema, body);
    const incomingTrustToken = (req.cookies as Record<string, string> | undefined)?.[DEVICE_TRUST_COOKIE];
    const session = await this.auth.deviceLogin(input, incomingTrustToken, req.correlationId);
    this.setSessionCookies(res, session);
    this.setDeviceTrustCookie(res, session.deviceTrustToken!);
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
    // Explicit sign-out also revokes this device's remembered-login trust
    // (docs/24 ADR-14) — the whole point of "unless they explicitly signed
    // out" is that this device shouldn't skip OTP again after this.
    await this.auth.revokeSession(req.auth!.userId, req.auth!.sessionId, "logout", req.correlationId, {
      revokeDeviceTrust: true,
    });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(REFRESH_COOKIE, { path: "/v1/auth" });
    res.clearCookie(DEVICE_TRUST_COOKIE, { path: "/v1/auth" });
  }

  /**
   * Device-centric, not session-centric (docs/24 ADR-14): a trusted device
   * can have zero *live* session at the moment and must still show up here
   * to stay revokable — the only safety net now that trust has no expiry.
   */
  @Get("devices")
  async devices(@Req() req: ApiRequest) {
    const items = await this.auth.listDevices(req.auth!.userId);
    return { items: items.map((d) => ({ ...d, isCurrent: d.id === req.auth!.userDeviceId })) };
  }

  @Delete("devices/:id")
  @HttpCode(204)
  async revokeDevice(@Param("id") id: string, @Req() req: ApiRequest) {
    await this.auth.revokeDevice(req.auth!.userId, id, req.correlationId);
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

  /**
   * Chrome (and RFC-6265bis-aligned browsers) hard-cap cookie lifetime at
   * ~400 days regardless of what's requested — rotated on every use (both
   * otp/verify and device-login always mint a fresh token), so this is
   * "indefinite until sign-out" in practice for anyone who opens the app at
   * least once a year (docs/24 ADR-14).
   */
  private setDeviceTrustCookie(res: Response, token: string): void {
    const secure = env().NODE_ENV === "production" || env().NODE_ENV === "staging";
    res.cookie(DEVICE_TRUST_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/v1/auth",
      maxAge: 400 * 24 * 60 * 60 * 1000,
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
