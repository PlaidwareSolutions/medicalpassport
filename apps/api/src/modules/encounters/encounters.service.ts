import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { emitHealthEvents, projectEncounter, supersedeHealthEvents } from "@medpass/health-events";
import type { EncounterInput, UpdateEncounterInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { eventCtx } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import { stampProvenanceFor, type ProvenanceActor } from "../../common/provenance-actor";

interface Actor extends ProvenanceActor {
  correlationId?: string;
}

/** Prisma transaction client — the subset this service actually uses. */
type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

const ENCOUNTER_INCLUDE = {
  organization: { select: { id: true, displayName: true } },
  practitioner: { select: { id: true, displayName: true } },
} as const;

const DETAIL_INCLUDE = {
  ...ENCOUNTER_INCLUDE,
  prescriptions: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" as const },
    select: { id: true, prescribedAt: true, practitioner: { select: { displayName: true } } },
  },
  medicalReports: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" as const },
    select: { id: true, kind: true, label: true, testedAt: true },
  },
  conditions: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" as const },
    select: { id: true, label: true, clinicalStatus: true },
  },
  procedures: {
    where: { deletedAt: null },
    orderBy: { performedOn: "asc" as const },
    select: { id: true, procedureText: true, performedOn: true },
  },
} as const;

const dateOnly = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Encounters (docs_v2/04 §3.3): one visit/admission that ties prescriptions,
 * reports, conditions and procedures together. Optional in the V2.0 UI —
 * every linked record is equally valid without one. Soft-delete only; the
 * linked rows keep their `encounterId` (this app never cascades a
 * soft-delete into child rows) and reads simply stop surfacing the parent.
 */
@Injectable()
export class EncountersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Confirms an encounter reference belongs to this profile before linking to it (used by prescriptions/reports too). */
  static async requireEncounter(tx: Tx, profileId: string, encounterId: string): Promise<{ id: string }> {
    const encounter = await tx.encounter.findFirst({
      where: { id: encounterId, patientProfileId: profileId, deletedAt: null },
      select: { id: true },
    });
    if (!encounter) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown encounter", 400);
    return encounter;
  }

  /** An organization is linkable when it belongs to this profile or is a shared (profile-less) one. */
  private async requireOrganization(tx: Tx, profileId: string, organizationId: string) {
    const organization = await tx.organization.findFirst({
      where: { id: organizationId, deletedAt: null, OR: [{ patientProfileId: profileId }, { patientProfileId: null }] },
      select: { id: true },
    });
    if (!organization) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown organization", 400);
    return organization;
  }

  private async requirePractitioner(tx: Tx, profileId: string, practitionerId: string) {
    const practitioner = await tx.practitioner.findFirst({
      where: { id: practitionerId, createdByProfileId: profileId, deletedAt: null },
      select: { id: true },
    });
    if (!practitioner) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown practitioner", 400);
    return practitioner;
  }

  async list(profileId: string) {
    const encounters = await this.prisma.encounter.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      include: ENCOUNTER_INCLUDE,
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });
    return encounters.map((e) => this.toDto(e));
  }

  async byId(profileId: string, id: string) {
    const encounter = await this.prisma.encounter.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: DETAIL_INCLUDE,
    });
    if (!encounter) return null;
    return {
      ...this.toDto(encounter),
      prescriptions: encounter.prescriptions.map((p) => ({
        id: p.id,
        prescribedAt: dateOnly(p.prescribedAt),
        practitionerName: p.practitioner?.displayName ?? null,
      })),
      medicalReports: encounter.medicalReports.map((r) => ({ id: r.id, kind: r.kind, label: r.label, testedAt: dateOnly(r.testedAt) })),
      conditions: encounter.conditions.map((c) => ({ id: c.id, label: c.label, clinicalStatus: c.clinicalStatus })),
      procedures: encounter.procedures.map((p) => ({ id: p.id, procedureText: p.procedureText, performedOn: dateOnly(p.performedOn) })),
    };
  }

  async create(profileId: string, input: EncounterInput, actor: Actor) {
    const created = await this.prisma.$transaction(async (tx) => {
      if (input.organizationId) await this.requireOrganization(tx, profileId, input.organizationId);
      if (input.practitionerId) await this.requirePractitioner(tx, profileId, input.practitionerId);
      const encounter = await tx.encounter.create({
        data: {
          patientProfileId: profileId,
          kind: input.kind,
          startedAt: input.startedAt,
          endedAt: input.endedAt ?? null,
          organizationId: input.organizationId ?? null,
          practitionerId: input.practitionerId ?? null,
          reasonText: input.reasonText ?? null,
          diagnosisText: input.diagnosisText ?? null,
          notes: input.notes ?? null,
          ...stampProvenanceFor(actor),
        },
        include: ENCOUNTER_INCLUDE,
      });
      await writeAudit(tx, {
        action: "encounter.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "encounter",
        entityId: encounter.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { kind: input.kind },
      });
      await this.emit(tx, profileId, actor, encounter);
      return encounter;
    });
    return (await this.byId(profileId, created.id))!;
  }

  async update(profileId: string, id: string, input: UpdateEncounterInput, actor: Actor) {
    const existing = await this.prisma.encounter.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Encounter not found", 404);

    await this.prisma.$transaction(async (tx) => {
      if (input.organizationId) await this.requireOrganization(tx, profileId, input.organizationId);
      if (input.practitionerId) await this.requirePractitioner(tx, profileId, input.practitionerId);
      const startedAt = input.startedAt ?? existing.startedAt;
      const endedAt = input.endedAt === undefined ? existing.endedAt : input.endedAt;
      if (endedAt && endedAt < startedAt) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "End is before start", 400);

      const updated = await tx.encounter.updateMany({
        where: { id, ...(input.rowVersion !== undefined ? { rowVersion: input.rowVersion } : {}) },
        data: {
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          startedAt,
          endedAt,
          ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
          ...(input.practitionerId !== undefined ? { practitionerId: input.practitionerId } : {}),
          ...(input.reasonText !== undefined ? { reasonText: input.reasonText } : {}),
          ...(input.diagnosisText !== undefined ? { diagnosisText: input.diagnosisText } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ApiProblem(ERROR_CODES.CONFLICT_ROW_VERSION, "This encounter was changed elsewhere. Reload and retry.", 409);
      }
      const fresh = await tx.encounter.findUniqueOrThrow({ where: { id }, include: ENCOUNTER_INCLUDE });
      await writeAudit(tx, {
        action: "encounter.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "encounter",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { fields: Object.keys(input).filter((k) => k !== "rowVersion") },
      });
      // A corrected encounter re-projects: the prior events are superseded,
      // the fresh ones appended (an unchanged key simply comes back live).
      await supersedeHealthEvents(tx, "encounter", id);
      await this.emit(tx, profileId, actor, fresh);
    });
    return (await this.byId(profileId, id))!;
  }

  async softDelete(profileId: string, id: string, actor: Actor) {
    const existing = await this.prisma.encounter.findFirst({ where: { id, patientProfileId: profileId, deletedAt: null } });
    if (!existing) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Encounter not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.encounter.update({ where: { id }, data: { deletedAt: new Date(), rowVersion: { increment: 1 } } });
      await writeAudit(tx, {
        action: "encounter.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "encounter",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
      await supersedeHealthEvents(tx, "encounter", id);
    });
  }

  private async emit(
    tx: Tx,
    profileId: string,
    actor: Actor,
    encounter: {
      id: string;
      kind: string;
      startedAt: Date;
      endedAt: Date | null;
      reasonText: string | null;
      provenanceSource: unknown;
      verification: unknown;
      recordedByUserId: string;
      organization: { displayName: string } | null;
      practitioner: { displayName: string } | null;
    },
  ): Promise<void> {
    const ctx = await eventCtx(tx, profileId, actor);
    await emitHealthEvents(
      tx,
      projectEncounter(ctx, {
        id: encounter.id,
        kind: encounter.kind,
        startedAt: encounter.startedAt,
        endedAt: encounter.endedAt,
        reasonText: encounter.reasonText,
        organizationName: encounter.organization?.displayName ?? null,
        practitionerName: encounter.practitioner?.displayName ?? null,
        provenanceSource: encounter.provenanceSource as never,
        verification: encounter.verification as never,
        recordedByUserId: encounter.recordedByUserId,
      }),
    );
  }

  private toDto(e: {
    id: string;
    kind: string;
    startedAt: Date;
    endedAt: Date | null;
    organizationId: string | null;
    practitionerId: string | null;
    reasonText: string | null;
    diagnosisText: string | null;
    notes: string | null;
    provenanceSource: string | null;
    verification: string | null;
    rowVersion: number;
    createdAt: Date;
    updatedAt: Date;
    organization: { displayName: string } | null;
    practitioner: { displayName: string } | null;
  }) {
    return {
      id: e.id,
      kind: e.kind,
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt?.toISOString() ?? null,
      organizationId: e.organizationId,
      organizationName: e.organization?.displayName ?? null,
      practitionerId: e.practitionerId,
      practitionerName: e.practitioner?.displayName ?? null,
      reasonText: e.reasonText,
      diagnosisText: e.diagnosisText,
      notes: e.notes,
      provenanceSource: e.provenanceSource,
      verification: e.verification,
      rowVersion: e.rowVersion,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
    };
  }
}
