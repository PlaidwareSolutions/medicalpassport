import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { acceptInviteSchema, inviteCaregiverSchema, updateCaregiverScopesSchema } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { phoneDigest } from "../../common/crypto";
import type { ApiRequest } from "../../common/http";
import { parseWith } from "../../common/zod";
import { PrismaService } from "../../common/prisma.service";
import { ProfileAccessService } from "../../common/profile-access.service";

@Controller()
export class CaregiversController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProfileAccessService,
  ) {}

  /** Patients see and manage who has access to them (screen 6). */
  @Get("profiles/current/caregivers")
  async list(@Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_caregivers");
    const items = await this.prisma.caregiverRelationship.findMany({
      where: { patientProfileId: profileId, status: { in: ["invited", "active"] } },
      include: { permissions: { where: { revokedAt: null } } },
      orderBy: { createdAt: "desc" },
    });
    return {
      items: items.map((r) => ({
        id: r.id,
        relationship: r.relationship,
        label: r.label,
        status: r.status,
        scopes: r.permissions.map((p) => p.scope),
        acceptedAt: r.acceptedAt,
        expiresAt: r.expiresAt,
      })),
    };
  }

  /** Invite a caregiver by phone with granular scopes (consent-backed). */
  @Post("profiles/current/caregivers")
  async invite(@Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_caregivers");
    const input = parseWith(inviteCaregiverSchema, body);
    const userId = req.auth!.userId;

    return this.prisma.$transaction(async (tx) => {
      const relationship = await tx.caregiverRelationship.create({
        data: {
          patientProfileId: profileId,
          invitedPhoneDigest: phoneDigest(input.phone),
          relationship: input.relationship,
          label: input.label,
          expiresAt: input.expiresAt,
          permissions: {
            create: input.scopes.map((scope) => ({ scope, grantedByUserId: userId })),
          },
        },
      });
      const consent = await tx.consent.create({
        data: {
          patientProfileId: profileId,
          type: "caregiver_access",
          purpose: `Caregiver access (${input.relationship}): ${input.scopes.join(", ")}`,
          expiresAt: input.expiresAt,
        },
      });
      await tx.consentEvent.create({ data: { consentId: consent.id, event: "granted", actorUserId: userId } });
      await writeAudit(tx, {
        action: "caregiver.invited",
        actorUserId: userId,
        actorType: "patient",
        entityType: "caregiver_relationship",
        entityId: relationship.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { scopes: input.scopes },
      });
      return { id: relationship.id, status: relationship.status };
    });
  }

  /** The invited person accepts with their own OTP-verified account. */
  @Post("caregivers/accept")
  async accept(@Body() body: unknown, @Req() req: ApiRequest) {
    const input = parseWith(acceptInviteSchema, body);
    const userId = req.auth!.userId;

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const invite = await this.prisma.caregiverRelationship.findFirst({
      where: { id: input.invitationId, status: "invited" },
    });
    if (!invite || invite.invitedPhoneDigest !== user.phoneDigest) {
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Invitation not found", 404);
    }
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Invitation expired", 404);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.caregiverRelationship.update({
        where: { id: invite.id },
        data: { caregiverUserId: userId, status: "active", acceptedAt: new Date() },
      });
      await writeAudit(tx, {
        action: "caregiver.accepted",
        actorUserId: userId,
        actorType: "caregiver",
        entityType: "caregiver_relationship",
        entityId: updated.id,
        patientProfileId: updated.patientProfileId,
        correlationId: req.correlationId,
      });
      return { id: updated.id, status: updated.status, patientProfileId: updated.patientProfileId };
    });
  }

  @Patch("caregivers/:relationshipId/scopes")
  async updateScopes(@Param("relationshipId") relationshipId: string, @Body() body: unknown, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_caregivers");
    const input = parseWith(updateCaregiverScopesSchema, body);
    const relationship = await this.requireRelationship(relationshipId, profileId);

    return this.prisma.$transaction(async (tx) => {
      await tx.caregiverPermission.updateMany({
        where: { caregiverRelationshipId: relationship.id, revokedAt: null, scope: { notIn: input.scopes } },
        data: { revokedAt: new Date() },
      });
      for (const scope of input.scopes) {
        const existing = await tx.caregiverPermission.findUnique({
          where: { caregiverRelationshipId_scope: { caregiverRelationshipId: relationship.id, scope } },
        });
        if (!existing) {
          await tx.caregiverPermission.create({
            data: { caregiverRelationshipId: relationship.id, scope, grantedByUserId: req.auth!.userId },
          });
        } else if (existing.revokedAt) {
          await tx.caregiverPermission.update({ where: { id: existing.id }, data: { revokedAt: null, grantedAt: new Date() } });
        }
      }
      if (input.label !== undefined) {
        await tx.caregiverRelationship.update({ where: { id: relationship.id }, data: { label: input.label } });
      }
      await writeAudit(tx, {
        action: "caregiver.scope_changed",
        actorUserId: req.auth!.userId,
        actorType: "patient",
        entityType: "caregiver_relationship",
        entityId: relationship.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
        context: { scopes: input.scopes },
      });
      return { id: relationship.id, scopes: input.scopes, label: input.label ?? relationship.label };
    });
  }

  /** Revocation is immediate — the next caregiver request 403s (docs/18). */
  @Delete("caregivers/:relationshipId")
  @HttpCode(204)
  async revoke(@Param("relationshipId") relationshipId: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_caregivers");
    const relationship = await this.requireRelationship(relationshipId, profileId);

    await this.prisma.$transaction(async (tx) => {
      await tx.caregiverRelationship.update({
        where: { id: relationship.id },
        data: { status: "revoked", revokedAt: new Date(), revokedByUserId: req.auth!.userId },
      });
      await tx.caregiverPermission.updateMany({
        where: { caregiverRelationshipId: relationship.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAudit(tx, {
        action: "caregiver.revoked",
        actorUserId: req.auth!.userId,
        actorType: "patient",
        entityType: "caregiver_relationship",
        entityId: relationship.id,
        patientProfileId: profileId,
        correlationId: req.correlationId,
      });
    });
  }

  /** Invitations addressed to the signed-in user's phone. */
  @Get("caregivers/invitations")
  async invitations(@Req() req: ApiRequest) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    const items = await this.prisma.caregiverRelationship.findMany({
      where: { invitedPhoneDigest: user.phoneDigest, status: "invited" },
      include: {
        patientProfile: { select: { displayName: true } },
        permissions: { where: { revokedAt: null } },
      },
    });
    return {
      items: items.map((i) => ({
        id: i.id,
        patientDisplayName: i.patientProfile.displayName,
        relationship: i.relationship,
        // Informed consent: the invitee should see exactly what they'd be
        // granted before accepting, not accept blind (docs/23 E3.2).
        scopes: i.permissions.map((p) => p.scope),
        expiresAt: i.expiresAt,
      })),
    };
  }

  /** Patient-visible access log (docs/23 E3.3, docs/07 screen 6 "last-used"). */
  @Get("caregivers/:relationshipId/accesses")
  async accesses(@Param("relationshipId") relationshipId: string, @Req() req: ApiRequest) {
    const { profileId } = await this.access.require(req, "manage_caregivers");
    const relationship = await this.requireRelationship(relationshipId, profileId);
    const events = await this.prisma.auditEvent.findMany({
      where: { entityType: "caregiver_relationship", entityId: relationship.id, action: "caregiver.access_used" },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    });
    return { items: events.map((e) => ({ accessedAt: e.occurredAt })) };
  }

  private async requireRelationship(id: string, profileId: string) {
    const relationship = await this.prisma.caregiverRelationship.findFirst({
      where: { id, patientProfileId: profileId },
    });
    if (!relationship) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Caregiver not found", 404);
    return relationship;
  }
}
