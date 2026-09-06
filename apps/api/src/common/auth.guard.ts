import { CanActivate, ExecutionContext, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES } from "@medpass/domain";
import { ApiProblem } from "./errors";
import { hashSessionToken } from "./crypto";
import { PrismaService } from "./prisma.service";
import type { ApiRequest } from "./http";

export const PUBLIC_ROUTE = "public_route";
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

export const SESSION_COOKIE = "medpass_session";

/**
 * ADR-V2-012: sensitive operations (sharing, caregiver management, account
 * deletion, exports, …) require the session to have re-verified recently.
 * The stamp lives on the session row (`stepUpVerifiedAt`), so revocation and
 * freshness are both server-side facts.
 */
export const REQUIRES_STEP_UP = "requires_step_up";
export const RequiresStepUp = () => SetMetadata(REQUIRES_STEP_UP, true);
export const STEP_UP_FRESHNESS_MS = 10 * 60 * 1000;

export function isStepUpFresh(stepUpVerifiedAt: Date | null | undefined, now = Date.now()): boolean {
  return !!stepUpVerifiedAt && now - stepUpVerifiedAt.getTime() <= STEP_UP_FRESHNESS_MS;
}

/**
 * Opaque-session authentication (ADR-5): token from httpOnly cookie (web) or
 * Authorization bearer (native). Revocation is immediate — the session row is
 * checked on every request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<ApiRequest>();
    const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    const token = bearer || cookieToken;
    if (!token) throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue", 401);

    // CSRF defense for cookie-borne, state-changing requests: require the
    // custom header the api-client always sends (SameSite=Lax is the backstop).
    if (!bearer && req.method !== "GET" && req.header("x-requested-with") !== "medpass") {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Missing request header", 403);
    }

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new ApiProblem(ERROR_CODES.SESSION_REVOKED, "Session expired. Sign in again.", 401);
    }
    if (session.user.status !== "active") {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Account unavailable", 403);
    }

    const requiresStepUp = this.reflector.getAllAndOverride<boolean>(REQUIRES_STEP_UP, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresStepUp && !isStepUpFresh(session.stepUpVerifiedAt)) {
      throw new ApiProblem(
        ERROR_CODES.STEP_UP_REQUIRED,
        "Please confirm it's you before continuing",
        403,
      );
    }

    req.auth = {
      userId: session.userId,
      sessionId: session.id,
      userDeviceId: session.userDeviceId,
      preferredLocale: session.user.preferredLocale,
    };
    return true;
  }
}
