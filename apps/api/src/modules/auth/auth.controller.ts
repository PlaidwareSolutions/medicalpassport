import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { otpRequestSchema, otpVerifySchema, refreshSchema } from "@medpass/validation";
import { env } from "../../common/env";
import { parseWith } from "../../common/zod";
import { Public, SESSION_COOKIE } from "../../common/auth.guard";
import type { ApiRequest } from "../../common/http";
import { AuthService, type IssuedSession } from "./auth.service";
import { PrismaService } from "../../common/prisma.service";

const REFRESH_COOKIE = "medpass_refresh";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post("otp/request")
  @HttpCode(202)
  async requestOtp(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(otpRequestSchema, body);
    await this.auth.requestOtp(input, req.ip, req.correlationId);
    // Enumeration-safe: same response whether or not the number exists.
    return { message: "If this number can receive codes, one has been sent." };
  }

  @Public()
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
    });
    return {
      user: { id: user.id, preferredLocale: user.preferredLocale },
      // Native clients read the bearer token; web relies on the cookie.
      token: session.token,
      profiles: profiles.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        relationship:
          (p.claimedByUserId ?? p.ownerUserId) === session.userId
            ? "self"
            : p.ownerUserId === session.userId
              ? "dependent"
              : "caregiver",
        rowVersion: p.rowVersion,
      })),
    };
  }
}
