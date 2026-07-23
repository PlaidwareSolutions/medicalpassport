import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { adminLoginSchema, adminMfaCodeSchema, adminRefreshSchema } from "@medpass/validation";
import { ERROR_CODES } from "@medpass/domain";
import { env } from "../../common/env";
import { parseWith } from "../../common/zod";
import { ApiProblem } from "../../common/errors";
import { Public } from "../../common/auth.guard";
import { AdminAuthGuard, AdminAllowPending, ADMIN_SESSION_COOKIE, ADMIN_REFRESH_COOKIE } from "../../common/admin-auth.guard";
import { RateLimit } from "../../common/rate-limit.guard";
import { verifyTurnstile } from "../../common/turnstile";
import type { ApiRequest } from "../../common/http";
import { AdminAuthService, type IssuedAdminSession } from "./admin-auth.service";

/**
 * Admin authentication (docs/18: email + password + mandatory TOTP MFA).
 * Every handler here carries @Public() to skip the *patient* AuthGuard —
 * that decorator does not mean "unprotected": AdminAuthGuard (applied where
 * a session already exists) is this controller's real access check.
 */
@Public()
@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @RateLimit({ name: "admin_login", limit: 10, windowSeconds: 3600 })
  @Post("login")
  async login(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const input = parseWith(adminLoginSchema, body);
    if (!(await verifyTurnstile(env().TURNSTILE_SECRET_KEY, input.turnstileToken, req.ip))) {
      throw new ApiProblem(ERROR_CODES.TURNSTILE_FAILED, "Verification failed. Please try again.", 400);
    }
    const { session, mfaEnrolled } = await this.adminAuth.login(input, req.correlationId);
    this.setSessionCookies(res, session);
    return { status: mfaEnrolled ? "mfa_required" : "mfa_enrollment_required" };
  }

  @UseGuards(AdminAuthGuard)
  @AdminAllowPending()
  @Post("mfa/enroll")
  async startEnroll(@Req() req: ApiRequest) {
    const me = await this.adminAuth.me(req.adminAuth!.adminUserId);
    return this.adminAuth.startMfaEnrollment(req.adminAuth!.adminUserId, me.email);
  }

  @UseGuards(AdminAuthGuard)
  @AdminAllowPending()
  @Post("mfa/enroll/confirm")
  async confirmEnroll(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(adminMfaCodeSchema, body);
    await this.adminAuth.confirmMfaEnrollment(req.adminAuth!.adminUserId, req.adminAuth!.sessionId, input.code, req.correlationId);
    return { status: "ready" };
  }

  @UseGuards(AdminAuthGuard)
  @AdminAllowPending()
  @Post("mfa/verify")
  async verifyMfa(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(adminMfaCodeSchema, body);
    await this.adminAuth.verifyMfa(req.adminAuth!.adminUserId, req.adminAuth!.sessionId, input.code, req.correlationId);
    return { status: "ready" };
  }

  @Post("refresh")
  async refresh(@Body() body: unknown, @Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const cookieRefresh = (req.cookies as Record<string, string> | undefined)?.[ADMIN_REFRESH_COOKIE];
    const input = cookieRefresh ? { refreshToken: cookieRefresh } : parseWith(adminRefreshSchema, body);
    const session = await this.adminAuth.refresh(input.refreshToken, req.correlationId);
    this.setSessionCookies(res, session);
    return { status: session.mfaVerified ? "ready" : "mfa_required" };
  }

  @UseGuards(AdminAuthGuard)
  @AdminAllowPending()
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    await this.adminAuth.revokeSession(req.adminAuth!.adminUserId, req.adminAuth!.sessionId, "logout", req.correlationId);
    res.clearCookie(ADMIN_SESSION_COOKIE, { path: "/" });
    res.clearCookie(ADMIN_REFRESH_COOKIE, { path: "/v1/admin/auth" });
  }

  @UseGuards(AdminAuthGuard)
  @Get("sessions")
  async sessions(@Req() req: ApiRequest) {
    const items = await this.adminAuth.listSessions(req.adminAuth!.adminUserId);
    return { items: items.map((s) => ({ ...s, current: s.id === req.adminAuth!.sessionId })) };
  }

  @UseGuards(AdminAuthGuard)
  @Delete("sessions/:id")
  @HttpCode(204)
  async revokeSession(@Param("id") id: string, @Req() req: ApiRequest) {
    await this.adminAuth.revokeSession(req.adminAuth!.adminUserId, id, "user_revoked", req.correlationId);
  }

  @UseGuards(AdminAuthGuard)
  @Get("me")
  async me(@Req() req: ApiRequest) {
    return this.adminAuth.me(req.adminAuth!.adminUserId);
  }

  private setSessionCookies(res: Response, session: IssuedAdminSession): void {
    const secure = env().NODE_ENV === "production" || env().NODE_ENV === "staging";
    res.cookie(ADMIN_SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      expires: session.expiresAt,
    });
    res.cookie(ADMIN_REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/v1/admin/auth",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }
}
