import { Injectable } from "@nestjs/common";
import { decideProfileAccess, type ProfileAction } from "@medpass/authorization";
import { ERROR_CODES, type CaregiverScope } from "@medpass/domain";
import { writeAudit } from "@medpass/audit";
import { ApiProblem } from "./errors";
import { PrismaService } from "./prisma.service";
import type { ApiRequest } from "./http";

/**
 * Resolves the caller's relationship to the X-Profile-Id target and enforces
 * the policy from @medpass/authorization per request — caregiver revocation
 * is therefore immediate (docs/18).
 */
@Injectable()
export class ProfileAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async require(req: ApiRequest, action: ProfileAction): Promise<{ profileId: string; actorRole: "patient" | "caregiver" }> {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiProblem(ERROR_CODES.UNAUTHENTICATED, "Sign in to continue", 401);

    const profileId = req.header("x-profile-id");
    if (!profileId || !/^[0-9a-f-]{36}$/i.test(profileId)) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Missing X-Profile-Id header", 400);
    }

    const { actorRole, caregiverScopes } = await this.requireForProfile(userId, profileId, action, req.correlationId);
    req.profileContext = { profileId, actorRole, caregiverScopes };
    return { profileId, actorRole };
  }

  /**
   * Same policy check as `require()`, but for callers that already have an
   * explicit (userId, profileId) pair instead of a single-profile request —
   * e.g. the sync endpoint, where each queued mutation names its own target
   * profile rather than relying on one X-Profile-Id header (docs/15).
   */
  async requireForProfile(
    userId: string,
    profileId: string,
    action: ProfileAction,
    correlationId?: string,
  ): Promise<{ actorRole: "patient" | "caregiver"; caregiverScopes: CaregiverScope[] }> {
    const profile = await this.prisma.patientProfile.findFirst({
      where: { id: profileId, deletedAt: null },
      select: { id: true, ownerUserId: true, claimedByUserId: true },
    });
    if (!profile) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Profile not found", 404);

    let caregiverScopes: CaregiverScope[] = [];
    const now = new Date();
    const relationship = await this.prisma.caregiverRelationship.findFirst({
      where: {
        patientProfileId: profileId,
        caregiverUserId: userId,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { permissions: { where: { revokedAt: null } } },
    });
    if (relationship) caregiverScopes = relationship.permissions.map((p) => p.scope);

    const decision = decideProfileAccess(
      {
        userId,
        profileOwnerUserId: profile.ownerUserId,
        profileClaimedByUserId: profile.claimedByUserId,
        caregiverScopes,
      },
      action,
    );

    if (!decision.allowed || decision.actorRole === "none") {
      throw new ApiProblem(ERROR_CODES.CAREGIVER_SCOPE_MISSING, "You don't have access to do this", 403);
    }

    // Every caregiver use of delegated access is audited (docs/18) — entity
    // fields let the patient-visible access log (docs/23 E3.3) find exactly
    // this relationship's history, not every caregiver's mixed together.
    if (decision.actorRole === "caregiver") {
      await writeAudit(this.prisma, {
        action: "caregiver.access_used",
        actorUserId: userId,
        actorType: "caregiver",
        entityType: "caregiver_relationship",
        entityId: relationship!.id,
        patientProfileId: profileId,
        correlationId,
        context: { action },
      });
    }

    return { actorRole: decision.actorRole, caregiverScopes };
  }

  /**
   * The pure decision for a caller whose relationship to the profile is
   * already in hand — no header, no throw, no audit. The family dashboard
   * (docs_v2/05 §8) spans every profile the caller can reach in one call,
   * and asks this per profile and per summary field so a scope that does
   * not grant a number yields `null` rather than a 403 for the whole
   * screen. Kept here so `decideProfileAccess` has exactly one caller in
   * apps/api (packages/authorization/test/matrix.test.ts enforces that).
   */
  decide(
    ctx: { userId: string; profileOwnerUserId: string; profileClaimedByUserId: string | null; caregiverScopes: readonly CaregiverScope[] },
    action: ProfileAction,
  ): boolean {
    return decideProfileAccess(ctx, action).allowed;
  }
}
