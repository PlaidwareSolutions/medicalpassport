import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ERROR_CODES } from "@medpass/domain";
import type { OrganizationMemberRole } from "@medpass/database";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import type { ApiRequest } from "../../common/http";
import { hashProviderToken, looksLikeProviderToken, PROVIDER_SESSION_COOKIE } from "./provider-session";

/** Header a staff member of several organizations sends to pick the one this request acts for. */
export const ORGANIZATION_HEADER = "x-organization-id";

/**
 * Provider-portal authentication + organization context (docs_v2/11 §5:
 * a separate evaluator — RBAC via `OrganizationMember.role`, relationship
 * access via `ProviderPatientLink` — sharing the patient guard's session
 * table but never its tokens). Every provider controller carries a
 * class-level `@Public()` to skip the *global* patient `AuthGuard`; this
 * guard is the real check, exactly like `AdminAuthGuard`.
 */
@Injectable()
export class ProviderGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    const bearer = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[PROVIDER_SESSION_COOKIE];
    const token = bearer || cookieToken;
    if (!token) throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue", 401);

    if (!bearer && req.method !== "GET" && req.header("x-requested-with") !== "medpass") {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Missing request header", 403);
    }

    // A patient or admin token is a different type; it never matches a
    // provider hash, but refusing on shape first keeps the failure obvious.
    if (!looksLikeProviderToken(token)) {
      throw new ApiProblem(ERROR_CODES.SESSION_REVOKED, "Session expired. Sign in again.", 401);
    }

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashProviderToken(token) },
      include: { user: { include: { organizationMembers: { where: { status: "active" }, include: { organization: true } } } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new ApiProblem(ERROR_CODES.SESSION_REVOKED, "Session expired. Sign in again.", 401);
    }
    if (session.user.status !== "active") throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Account unavailable", 403);
    if (session.user.userKind === "patient") throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Not a provider account", 403);

    const memberships = session.user.organizationMembers.filter((m) => !m.organization.deletedAt);
    if (memberships.length === 0) {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "This account is not a member of any organization", 403);
    }
    const requested = req.header(ORGANIZATION_HEADER);
    const membership = requested ? memberships.find((m) => m.organizationId === requested) : memberships[0];
    if (!membership) {
      throw new ApiProblem(ERROR_CODES.FORBIDDEN, "You are not a member of that organization", 403);
    }
    if (!requested && memberships.length > 1) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, `Send ${ORGANIZATION_HEADER} to choose the organization`, 400, [
        { path: ORGANIZATION_HEADER, message: "Required when you belong to several organizations" },
      ]);
    }

    req.providerAuth = {
      userId: session.userId,
      sessionId: session.id,
      organizationId: membership.organizationId,
      organizationKind: membership.organization.kind,
      memberId: membership.id,
      role: membership.role as OrganizationMemberRole,
    };
    return true;
  }
}

/** 403 unless the caller's membership is `owner` — organization settings and the member list. */
export function requireOwner(req: ApiRequest): NonNullable<ApiRequest["providerAuth"]> {
  const auth = req.providerAuth;
  if (!auth) throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue", 401);
  if (auth.role !== "owner") throw new ApiProblem(ERROR_CODES.FORBIDDEN, "Only an organization owner can do this", 403);
  return auth;
}

export function providerContext(req: ApiRequest): NonNullable<ApiRequest["providerAuth"]> {
  const auth = req.providerAuth;
  if (!auth) throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue", 401);
  return auth;
}
