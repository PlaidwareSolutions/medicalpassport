import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { CreatePractitionerInput, UpdatePractitionerInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

interface Actor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

/** Prisma transaction client — the subset this service actually uses. */
type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/**
 * "My doctors" (docs/07 screen 43 follow-up): one per-profile record per
 * doctor, referenced by medicines, prescriptions, and test reports alike.
 * Every display of a doctor's name joins through this row, so a rename here
 * propagates everywhere at once — that propagation, plus merge for cleaning
 * up near-duplicate spellings, is the whole point of managing these as
 * records instead of loose text.
 */
@Injectable()
export class PractitionersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reuses this profile's existing record for the same doctor name rather
   * than inserting a duplicate. The single shared implementation behind
   * every free-text prescriber/doctor field (medications, prescriptions,
   * reports) — one rule, one place, so a doctor typed anywhere resolves to
   * one row.
   */
  async resolve(tx: Tx, profileId: string, name: string | undefined): Promise<string | null> {
    const displayName = name?.trim();
    if (!displayName) return null;
    const existing = await tx.practitioner.findFirst({
      where: { createdByProfileId: profileId, displayName: { equals: displayName, mode: "insensitive" }, deletedAt: null },
    });
    if (existing) return existing.id;
    const created = await tx.practitioner.create({ data: { displayName, createdByProfileId: profileId } });
    return created.id;
  }

  /** Usage-annotated list for the picker and the manage screen, most-used first. */
  async list(profileId: string) {
    const practitioners = await this.prisma.practitioner.findMany({
      where: { createdByProfileId: profileId, deletedAt: null },
      include: {
        _count: {
          select: {
            medications: { where: { deletedAt: null } },
            prescriptions: { where: { deletedAt: null } },
            medicalReports: { where: { deletedAt: null } },
          },
        },
      },
    });
    return practitioners
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        speciality: p.speciality,
        medicationCount: p._count.medications,
        prescriptionCount: p._count.prescriptions,
        reportCount: p._count.medicalReports,
        createdAt: p.createdAt.toISOString(),
      }))
      .sort(
        (a, b) =>
          b.medicationCount + b.prescriptionCount + b.reportCount - (a.medicationCount + a.prescriptionCount + a.reportCount) ||
          a.displayName.localeCompare(b.displayName),
      );
  }

  /**
   * Explicit creation from the picker's "new doctor" flow or the manage
   * screen. Same dedup rule as resolve(): naming an existing doctor updates
   * that record's speciality (if given) instead of minting a duplicate.
   */
  async create(profileId: string, input: CreatePractitionerInput, actor: Actor) {
    const id = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.practitioner.findFirst({
        where: { createdByProfileId: profileId, displayName: { equals: input.displayName, mode: "insensitive" }, deletedAt: null },
      });
      if (existing) {
        if (input.speciality && input.speciality !== existing.speciality) {
          await tx.practitioner.update({ where: { id: existing.id }, data: { speciality: input.speciality } });
          await writeAudit(tx, {
            action: "practitioner.updated",
            actorUserId: actor.userId,
            actorType: actor.actorRole,
            entityType: "practitioner",
            entityId: existing.id,
            patientProfileId: profileId,
            correlationId: actor.correlationId,
            context: { specialityChanged: true },
          });
        }
        return existing.id;
      }
      const created = await tx.practitioner.create({
        data: { displayName: input.displayName, speciality: input.speciality ?? null, createdByProfileId: profileId },
      });
      await writeAudit(tx, {
        action: "practitioner.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "practitioner",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
      return created.id;
    });
    return (await this.list(profileId)).find((p) => p.id === id)!;
  }

  /**
   * Rename and/or set speciality. Renaming onto another existing doctor's
   * name is rejected toward merge instead — silently fusing two records
   * under an edit would be a surprise with clinical-record consequences.
   */
  async update(profileId: string, id: string, input: UpdatePractitionerInput, actor: Actor) {
    const practitioner = await this.requireOwn(profileId, id);
    if (input.displayName && input.displayName.toLowerCase() !== practitioner.displayName.toLowerCase()) {
      const clash = await this.prisma.practitioner.findFirst({
        where: {
          createdByProfileId: profileId,
          displayName: { equals: input.displayName, mode: "insensitive" },
          deletedAt: null,
          id: { not: id },
        },
      });
      if (clash) {
        throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Another doctor already has this name — merge them instead", 400);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.practitioner.update({
        where: { id },
        data: {
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.speciality !== undefined ? { speciality: input.speciality || null } : {}),
        },
      });
      await writeAudit(tx, {
        action: "practitioner.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "practitioner",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { renamed: input.displayName !== undefined && input.displayName !== practitioner.displayName },
      });
    });
    return (await this.list(profileId)).find((p) => p.id === id)!;
  }

  /**
   * Repoints every medicine, prescription, and report from `id` onto
   * `targetId`, then soft-deletes the emptied record — the cleanup path for
   * near-duplicate spellings ("Dr. Sharma" / "Dr Sharma") that case-
   * insensitive dedup can't catch. The target keeps its own name and
   * speciality; only links move.
   */
  async merge(profileId: string, id: string, targetId: string, actor: Actor) {
    if (id === targetId) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Cannot merge a doctor into themselves", 400);
    await this.requireOwn(profileId, id);
    await this.requireOwn(profileId, targetId);

    await this.prisma.$transaction(async (tx) => {
      const moved = {
        medications: (await tx.patientMedication.updateMany({ where: { practitionerId: id }, data: { practitionerId: targetId } }))
          .count,
        prescriptions: (await tx.prescription.updateMany({ where: { practitionerId: id }, data: { practitionerId: targetId } }))
          .count,
        reports: (await tx.medicalReport.updateMany({ where: { practitionerId: id }, data: { practitionerId: targetId } })).count,
      };
      await tx.practitioner.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAudit(tx, {
        action: "practitioner.merged",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "practitioner",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { targetId, ...moved },
      });
    });
    return (await this.list(profileId)).find((p) => p.id === targetId)!;
  }

  /**
   * Soft-delete, and only when nothing references the record — a doctor
   * still named on a medicine/prescription/report must be merged (or those
   * records edited) first, never silently unlinked.
   */
  async softDelete(profileId: string, id: string, actor: Actor) {
    await this.requireOwn(profileId, id);
    const usage = await this.list(profileId).then((all) => all.find((p) => p.id === id)!);
    if (usage.medicationCount + usage.prescriptionCount + usage.reportCount > 0) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This doctor is still linked to records — merge instead of deleting", 400);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.practitioner.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAudit(tx, {
        action: "practitioner.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "practitioner",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }

  private async requireOwn(profileId: string, id: string) {
    const practitioner = await this.prisma.practitioner.findFirst({
      where: { id, createdByProfileId: profileId, deletedAt: null },
    });
    if (!practitioner) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Doctor not found", 404);
    return practitioner;
  }
}
