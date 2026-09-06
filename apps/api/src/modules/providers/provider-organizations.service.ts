import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { Organization, OrganizationMember } from "@medpass/database";
import type { AddOrganizationMemberInput, UpdateOrganizationMemberInput, UpdateProviderOrganizationInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { decryptField, encryptField, phoneDigest } from "../../common/crypto";

interface Actor {
  userId: string;
  organizationId: string;
  correlationId?: string;
}

/** Which proposal kinds an organization of each kind may send (docs_v2/05 §11). */
export const PROPOSAL_KINDS_BY_ORGANIZATION: Readonly<Record<string, readonly string[]>> = {
  clinic: ["reconciliation", "prescription", "encounter"],
  hospital: ["reconciliation", "prescription", "encounter", "discharge_transition"],
  pharmacy: ["dispense"],
  laboratory: ["diagnostic_report"],
  diagnostic_centre: ["diagnostic_report"],
  other: [],
};

function organizationDto(org: Organization, role: string, memberCount: number) {
  return {
    id: org.id,
    kind: org.kind,
    displayName: org.displayName,
    addressText: org.addressText,
    city: org.city,
    state: org.state,
    pincode: org.pincode,
    phone: org.phoneCiphertext ? decryptField(org.phoneCiphertext) : null,
    hfrId: org.hfrId,
    verification: org.verification,
    role,
    memberCount,
    allowedProposalKinds: PROPOSAL_KINDS_BY_ORGANIZATION[org.kind] ?? [],
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

function memberDto(m: OrganizationMember & { user: { phoneCiphertext: string; email: string | null } }) {
  return {
    id: m.id,
    userId: m.userId,
    role: m.role,
    status: m.status,
    phone: decryptField(m.user.phoneCiphertext),
    email: m.user.email,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * The organization a provider session acts for (docs_v2/05 §11). Members
 * are ordinary `User` rows with `userKind` provider (or `both` when the
 * same person is also a patient) joined through `OrganizationMember`;
 * there is no self-serve organization creation here — the first owner is
 * seeded by the admin portal / pilot onboarding.
 */
@Injectable()
export class ProviderOrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async current(organizationId: string, role: string) {
    const org = await this.prisma.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
    if (!org) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Organization not found", 404);
    const memberCount = await this.prisma.organizationMember.count({ where: { organizationId, status: "active" } });
    return organizationDto(org, role, memberCount);
  }

  async update(input: UpdateProviderOrganizationInput, actor: Actor, role: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: actor.organizationId },
        data: {
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.addressText !== undefined ? { addressText: input.addressText } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.pincode !== undefined ? { pincode: input.pincode } : {}),
          ...(input.phone !== undefined ? { phoneCiphertext: input.phone ? encryptField(input.phone) : null } : {}),
        },
      });
      await writeAudit(tx, {
        action: "provider.organization_updated",
        actorUserId: actor.userId,
        actorType: "provider",
        entityType: "organization",
        entityId: actor.organizationId,
        correlationId: actor.correlationId,
        context: { organizationId: actor.organizationId, fields: Object.keys(input) },
      });
    });
    return this.current(actor.organizationId, role);
  }

  async listMembers(organizationId: string) {
    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId, status: { not: "removed" } },
      include: { user: { select: { phoneCiphertext: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    return members.map(memberDto);
  }

  async addMember(input: AddOrganizationMemberInput, actor: Actor) {
    const digest = phoneDigest(input.phone);
    const created = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { phoneDigest: digest } });
      if (!user) {
        user = await tx.user.create({
          data: { phoneDigest: digest, phoneCiphertext: encryptField(input.phone), userKind: "provider" },
        });
      } else if (user.userKind === "patient") {
        user = await tx.user.update({ where: { id: user.id }, data: { userKind: "both" } });
      }
      const existing = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: actor.organizationId, userId: user.id } },
      });
      if (existing && existing.status === "active") {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Already a member of this organization", 400, [
          { path: "phone", message: "Already a member" },
        ]);
      }
      const member = existing
        ? await tx.organizationMember.update({
            where: { id: existing.id },
            data: { role: input.role, status: "active", invitedByUserId: actor.userId },
            include: { user: { select: { phoneCiphertext: true, email: true } } },
          })
        : await tx.organizationMember.create({
            data: { organizationId: actor.organizationId, userId: user.id, role: input.role, invitedByUserId: actor.userId },
            include: { user: { select: { phoneCiphertext: true, email: true } } },
          });
      await writeAudit(tx, {
        action: "provider.member_added",
        actorUserId: actor.userId,
        actorType: "provider",
        entityType: "organization_member",
        entityId: member.id,
        correlationId: actor.correlationId,
        context: { organizationId: actor.organizationId, role: input.role, reactivated: Boolean(existing) },
      });
      return member;
    });
    return memberDto(created);
  }

  async updateMember(memberId: string, input: UpdateOrganizationMemberInput, actor: Actor) {
    const member = await this.requireMember(memberId, actor.organizationId);
    await this.prisma.$transaction(async (tx) => {
      const demotingOwner = member.role === "owner" && ((input.role && input.role !== "owner") || input.status === "suspended");
      if (demotingOwner) await this.requireAnotherOwner(tx, actor.organizationId, member.id);
      await tx.organizationMember.update({
        where: { id: member.id },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      });
      await writeAudit(tx, {
        action: "provider.member_updated",
        actorUserId: actor.userId,
        actorType: "provider",
        entityType: "organization_member",
        entityId: member.id,
        correlationId: actor.correlationId,
        context: { organizationId: actor.organizationId, fields: Object.keys(input) },
      });
    });
    const fresh = await this.prisma.organizationMember.findUniqueOrThrow({
      where: { id: member.id },
      include: { user: { select: { phoneCiphertext: true, email: true } } },
    });
    return memberDto(fresh);
  }

  async removeMember(memberId: string, actor: Actor): Promise<void> {
    const member = await this.requireMember(memberId, actor.organizationId);
    await this.prisma.$transaction(async (tx) => {
      if (member.role === "owner") await this.requireAnotherOwner(tx, actor.organizationId, member.id);
      await tx.organizationMember.update({ where: { id: member.id }, data: { status: "removed" } });
      // Their open provider sessions lose this organization immediately
      // (the guard re-reads memberships on every request); nothing else to revoke.
      await writeAudit(tx, {
        action: "provider.member_removed",
        actorUserId: actor.userId,
        actorType: "provider",
        entityType: "organization_member",
        entityId: member.id,
        correlationId: actor.correlationId,
        context: { organizationId: actor.organizationId },
      });
    });
  }

  private async requireMember(memberId: string, organizationId: string) {
    const member = await this.prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId, status: { not: "removed" } },
    });
    if (!member) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Member not found", 404);
    return member;
  }

  private async requireAnotherOwner(
    tx: { organizationMember: { count: PrismaService["organizationMember"]["count"] } },
    organizationId: string,
    exceptMemberId: string,
  ): Promise<void> {
    const owners = await tx.organizationMember.count({
      where: { organizationId, role: "owner", status: "active", id: { not: exceptMemberId } },
    });
    if (owners === 0) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "An organization must keep at least one owner", 400, [
        { path: "role", message: "Last owner" },
      ]);
    }
  }
}
