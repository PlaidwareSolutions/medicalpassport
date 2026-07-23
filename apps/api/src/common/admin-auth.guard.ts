import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES } from "@medpass/domain";
import type { AdminDuty } from "@medpass/authorization";
import { ApiProblem } from "./errors";
import { hashSessionToken } from "./crypto";
import { PrismaService } from "./prisma.service";
import type { ApiRequest } from "./http";

export const ADMIN_SESSION_COOKIE = "medpass_admin_session";
export const ADMIN_REFRESH_COOKIE = "medpass_admin_refresh";

/** Lets the 3 MFA-step endpoints (enroll/enroll-confirm/verify) run against
 * a still-pending (password-verified, MFA-pending) AdminSession — every
 * other admin route requires a fully MFA-verified session. */
export const ADMIN_ALLOW_PENDING = "admin_allow_pending";
export const AdminAllowPending = () => SetMetadata(ADMIN_ALLOW_PENDING, true);

/**
 * Admin-portal authentication — entirely separate from patient AuthGuard
 * (different table, different cookie, different privilege model). Every
 * admin controller also needs @Public() at the class level to skip the
 * *global* patient AuthGuard; @Public() only bypasses that guard, it does
 * NOT mean "unprotected" here — this guard is the real check.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowPending = this.reflector.getAllAndOverride<boolean>(ADMIN_ALLOW_PENDING, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<ApiRequest>();
    const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[ADMIN_SESSION_COOKIE];
    const token = bearer || cookieToken;
    if (!token) throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue", 401);

    if (!bearer && req.method !== "GET" && req.header("x-requested-with") !== "medpass") {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Missing request header", 403);
    }

    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { adminUser: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new ApiProblem(ERROR_CODES.SESSION_REVOKED, "Session expired. Sign in again.", 401);
    }
    if (!session.mfaVerifiedAt && !allowPending) {
      throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "MFA verification required", 401);
    }
    if (session.adminUser.status !== "active") {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Account unavailable", 403);
    }

    req.adminAuth = {
      adminUserId: session.adminUserId,
      sessionId: session.id,
      duties: session.adminUser.duties as AdminDuty[],
    };
    return true;
  }
}
