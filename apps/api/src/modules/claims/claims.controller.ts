import { Body, Controller, Delete, Get, HttpCode, Post, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { claimInviteSchema, claimProfileSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { phoneDigest } from "../../common/crypto";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";

type DependentRelationshipKind = "parent" | "child" | "spouse" | "sibling" | "other";

/**
 * Inverts the caregiver's recorded relationship TO the dependent into the
 * dependent's relationship to the caregiver, once the dependent claims the
 * profile — e.g. a caregiver who recorded "child" (the profile subject is
 * their child) means the caregiver is the claimant's "parent" going forward.
 * Falls back to "other" for both the missing-column case (profiles created
 * before this migration have `dependentRelationship: null`) and any
 * unrecognized value, rather than throwing.
 */
const INVERSE_RELATIONSHIP: Record<DependentRelationshipKind, DependentRelationshipKind> = {
  parent: "child",
  child: "parent",
  spouse: "spouse",
  sibling: "sibling",
  other: "other",
};

function invertRelationship(value: string | null): DependentRelationshipKind {
  return INVERSE_RELATIONSHIP[value as DependentRelationshipKind] ?? "other";
}

/**
 * Lets the actual person a dependent profile represents take over as its
 * real owner (docs/07 screen 5, docs/23 E3.1 "claimable later") — the
 * `PatientProfile.claimedByUserId` column has existed since early in the
 * project with nothing using it until now.
 */
@Controller()
export class ClaimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
  ) {}

  /** Owner-only — invites the profile's actual subject to claim it. */
  @Post("profiles/current/claim-invite")
  async inviteToClaim(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_claim");
    const input = parseWith(claimInviteSchema, body);

    await this.prisma.patientProfile.update({
      where: { id: profileId },
      data: {
        claimInvitedPhoneDigest: phoneDigest(input.phone),
        claimInvitedAt: new Date(),
        claimInviteExpiresAt: input.expiresAt ?? null,
      },
    });
    await writeAudit(this.prisma, {
      action: "profile.claim_invited",
      actorUserId: req.auth!.userId,
      actorType: "patient",
      entityType: "patient_profile",
      entityId: profileId,
      patientProfileId: profileId,
      correlationId: req.correlationId,
    });
    return { id: profileId, status: "invited" };
  }

  /** Owner-only — cancels a pending claim invitation. */
  @Delete("profiles/current/claim-invite")
  @HttpCode(204)
  async cancelClaimInvite(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_claim");
    await this.prisma.patientProfile.update({
      where: { id: profileId },
      data: { claimInvitedPhoneDigest: null, claimInvitedAt: null, claimInviteExpiresAt: null },
    });
    await writeAudit(this.prisma, {
      action: "profile.claim_invite_cancelled",
      actorUserId: req.auth!.userId,
      actorType: "patient",
      entityType: "patient_profile",
      entityId: profileId,
      patientProfileId: profileId,
      correlationId: req.correlationId,
    });
  }

  /** Claim invitations addressed to the signed-in user's own phone — not profile-scoped. */
  @Get("profiles/claim-invitations")
  async invitations(@Req() req: ApiRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    const now = new Date();
    const items = await this.prisma.patientProfile.findMany({
      where: {
        claimInvitedPhoneDigest: user.phoneDigest,
        claimedByUserId: null,
        deletedAt: null,
        OR: [{ claimInviteExpiresAt: null }, { claimInviteExpiresAt: { gt: now } }],
      },
    });
    return { items: items.map((p) => ({ profileId: p.id, displayName: p.displayName, yearOfBirth: p.yearOfBirth })) };
  }

  /**
   * Claims a profile — not profile-scoped (the claimant has no relationship
   * to route through X-Profile-Id until this succeeds, same reasoning as
   * caregivers.controller.ts's accept()). Per the product decision: the
   * original owner automatically keeps caregiver-level (full_management)
   * access, granted here, not something the claimant has to separately
   * re-grant.
   */
  @Post("profiles/claim")
  async claim(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(claimProfileSchema, body);
    const userId = req.auth!.userId;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const profile = await this.prisma.patientProfile.findFirst({
      where: { id: input.profileId, claimedByUserId: null, deletedAt: null },
    });
    if (!profile || profile.claimInvitedPhoneDigest !== user.phoneDigest) {
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Invitation not found", 404);
    }
    if (profile.claimInviteExpiresAt && profile.claimInviteExpiresAt < new Date()) {
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Invitation expired", 404);
    }
    if (profile.ownerUserId === userId) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "You already own this profile", 400);
    }

    return this.prisma.$transaction(async (tx) => {
      // Atomic guarded update — a double-tap or a genuine race must not
      // both pass the checks above and both create a reciprocal relationship.
      const updated = await tx.patientProfile.updateMany({
        where: { id: input.profileId, claimedByUserId: null, claimInvitedPhoneDigest: user.phoneDigest },
        data: { claimedByUserId: userId, claimInvitedPhoneDigest: null, claimInvitedAt: null, claimInviteExpiresAt: null },
      });
      if (updated.count === 0) {
        throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Invitation not found", 404);
      }

      const owner = await tx.user.findUniqueOrThrow({ where: { id: profile.ownerUserId } });
      const relationship = await tx.caregiverRelationship.create({
        data: {
          patientProfileId: profile.id,
          caregiverUserId: profile.ownerUserId,
          // Nothing was actually "invited" here — populated for schema
          // non-nullability, not a real pending invite.
          invitedPhoneDigest: owner.phoneDigest,
          relationship: invertRelationship(profile.dependentRelationship),
          status: "active",
          acceptedAt: new Date(),
          permissions: { create: [{ scope: "full_management", grantedByUserId: userId }] },
        },
      });

      // A genuinely new consent moment: the data subject consenting for
      // themselves for the first time, distinct from the original
      // caregiver_access consent recorded by a proxy before they could
      // consent at all (that original consent is left untouched as
      // historical record, not revoked or superseded).
      const consent = await tx.consent.create({
        data: {
          patientProfileId: profile.id,
          type: "caregiver_access",
          purpose: `Caregiver access retained after claim (${relationship.relationship}): full_management`,
        },
      });
      await tx.consentEvent.create({ data: { consentId: consent.id, event: "granted", actorUserId: userId } });

      await writeAudit(tx, {
        action: "profile.claimed",
        actorUserId: userId,
        actorType: "patient",
        entityType: "patient_profile",
        entityId: profile.id,
        patientProfileId: profile.id,
        correlationId: req.correlationId,
      });
      await writeAudit(tx, {
        action: "caregiver.granted_on_claim",
        actorUserId: userId,
        actorType: "system",
        entityType: "caregiver_relationship",
        entityId: relationship.id,
        patientProfileId: profile.id,
        correlationId: req.correlationId,
        context: { caregiverUserId: profile.ownerUserId },
      });

      return { id: profile.id, displayName: profile.displayName };
    });
  }
}
