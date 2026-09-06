import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, type AuditAction } from "@medpass/domain";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "@medpass/validation";
import { decryptField, encryptField } from "../../common/crypto";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { restampProvenance, type ProvenanceStamp } from "../../common/provenance";

export interface OrganizationWriteContext {
  profileId: string;
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
  provenance: ProvenanceStamp;
}

type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/**
 * Patient-scoped facilities (docs_v2/04 §3.1): the "where" behind doctors,
 * visits, immunizations and procedures. Mirrors the practitioners module —
 * one record per facility, rename propagates everywhere, merge repoints
 * every link before soft-deleting the duplicate, delete refuses while
 * anything still references the record. Organizations are reference data
 * and produce no timeline event. `hfrId`/`verification` beyond
 * patient-confirmed are ABDM-set only.
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(profileId: string) {
    const rows = await this.prisma.organization.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      include: this.usageInclude,
      orderBy: [{ displayName: "asc" }],
    });
    return rows.map((row) => this.present(row));
  }

  async get(profileId: string, id: string) {
    return this.present(await this.requireOwn(profileId, id));
  }

  async create(ctx: OrganizationWriteContext, input: CreateOrganizationInput) {
    const { phone, ...rest } = input;
    const id = await this.prisma.$transaction(async (tx) => {
      const row = await tx.organization.create({
        data: {
          ...rest,
          phoneCiphertext: phone ? encryptField(phone) : null,
          patientProfileId: ctx.profileId,
          verification: ctx.provenance.verification,
          recordedByUserId: ctx.userId,
        },
      });
      await this.audit(tx, ctx, "organization.created", row.id);
      return row.id;
    });
    return this.get(ctx.profileId, id);
  }

  async update(ctx: OrganizationWriteContext, id: string, input: UpdateOrganizationInput) {
    const existing = await this.requireOwn(ctx.profileId, id);
    const { phone, ...rest } = input;
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id },
        data: {
          ...rest,
          ...(phone !== undefined ? { phoneCiphertext: phone ? encryptField(phone) : null } : {}),
          verification: restampProvenance(existing.verification, ctx.provenance).verification,
          recordedByUserId: ctx.userId,
        },
      });
      await this.audit(tx, ctx, "organization.updated", id, { fields: Object.keys(input) });
    });
    return this.get(ctx.profileId, id);
  }

  /**
   * Repoints every encounter, doctor, immunization and procedure from `id`
   * onto `intoId`, records the merge on the emptied row (`mergedIntoId`) and
   * soft-deletes it. The target keeps its own details; only links move.
   */
  async merge(ctx: OrganizationWriteContext, id: string, intoId: string) {
    if (id === intoId) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Cannot merge a facility into itself", 400);
    await this.requireOwn(ctx.profileId, id);
    await this.requireOwn(ctx.profileId, intoId);
    await this.prisma.$transaction(async (tx) => {
      const moved = {
        encounters: (await tx.encounter.updateMany({ where: { organizationId: id }, data: { organizationId: intoId } })).count,
        practitioners: (await tx.practitioner.updateMany({ where: { organizationId: id }, data: { organizationId: intoId } })).count,
        immunizations: (await tx.immunization.updateMany({ where: { organizationId: id }, data: { organizationId: intoId } })).count,
        procedures: (await tx.procedure.updateMany({ where: { organizationId: id }, data: { organizationId: intoId } })).count,
      };
      await tx.organization.update({ where: { id }, data: { mergedIntoId: intoId, deletedAt: new Date() } });
      await this.audit(tx, ctx, "organization.merged", id, { intoId, ...moved });
    });
    return this.get(ctx.profileId, intoId);
  }

  /** Soft-delete, only when nothing references the record — otherwise merge. */
  async softDelete(ctx: OrganizationWriteContext, id: string): Promise<void> {
    await this.requireOwn(ctx.profileId, id);
    const usage = await this.usage(id);
    if (usage.encounterCount + usage.practitionerCount + usage.immunizationCount + usage.procedureCount > 0) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This facility is still linked to records — merge instead of deleting", 400);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit(tx, ctx, "organization.deleted", id);
    });
  }

  private readonly usageInclude = {
    _count: { select: { encounters: { where: { deletedAt: null } }, practitioners: { where: { deletedAt: null } } } },
  } as const;

  private async usage(id: string) {
    const [row, immunizationCount, procedureCount] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id }, include: this.usageInclude }),
      this.prisma.immunization.count({ where: { organizationId: id, deletedAt: null } }),
      this.prisma.procedure.count({ where: { organizationId: id, deletedAt: null } }),
    ]);
    return { encounterCount: row._count.encounters, practitionerCount: row._count.practitioners, immunizationCount, procedureCount };
  }

  private async requireOwn(profileId: string, id: string) {
    const row = await this.prisma.organization.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: this.usageInclude,
    });
    if (!row) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Facility not found", 404);
    return row;
  }

  private present(row: NonNullable<Awaited<ReturnType<OrganizationsService["requireOwn"]>>>) {
    return {
      id: row.id,
      kind: row.kind,
      displayName: row.displayName,
      addressText: row.addressText,
      city: row.city,
      state: row.state,
      pincode: row.pincode,
      phone: row.phoneCiphertext ? decryptField(row.phoneCiphertext) : null,
      hfrId: row.hfrId,
      verification: row.verification,
      mergedIntoId: row.mergedIntoId,
      encounterCount: row._count.encounters,
      practitionerCount: row._count.practitioners,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private audit(tx: Tx, ctx: OrganizationWriteContext, action: AuditAction, entityId: string, context?: Record<string, unknown>) {
    return writeAudit(tx, {
      action,
      actorUserId: ctx.userId,
      actorType: ctx.actorRole,
      entityType: "organization",
      entityId,
      patientProfileId: ctx.profileId,
      correlationId: ctx.correlationId,
      context,
    });
  }
}
