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

    // Every caregiver use of delegated access is audited (docs/18).
    if (decision.actorRole === "caregiver") {
      await writeAudit(this.prisma, {
        action: "caregiver.access_used",
        actorUserId: userId,
        actorType: "caregiver",
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { action },
      });
    }

    req.profileContext = { profileId, actorRole: decision.actorRole, caregiverScopes };
    return { profileId, actorRole: decision.actorRole };
  }
}
