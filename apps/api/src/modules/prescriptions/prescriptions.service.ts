import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { CreatePrescriptionInput } from "@medpass/validation";
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
 * Prescription records (docs/07 screen 43, docs/13 "prescriptions") — a
 * standing archive of what each doctor prescribed at each visit, with the
 * uploaded prescription itself as evidence. Deliberately independent of
 * medications: a prescription can be filed with zero medications linked
 * (a record of the visit), and a medication needs no prescription to be
 * valid — the link is optional in both directions.
 */
@Injectable()
export class PrescriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reuses this profile's existing record for the same doctor name rather
   * than inserting a duplicate — the same rule medications.service.ts
   * applies, so a doctor typed in either place resolves to one row.
   */
  private async resolvePractitioner(tx: Tx, profileId: string, practitionerName: string | undefined): Promise<string | null> {
    const displayName = practitionerName?.trim();
    if (!displayName) return null;
    const existing = await tx.practitioner.findFirst({
      where: { createdByProfileId: profileId, displayName: { equals: displayName, mode: "insensitive" }, deletedAt: null },
    });
    if (existing) return existing.id;
    const created = await tx.practitioner.create({ data: { displayName, createdByProfileId: profileId } });
    return created.id;
  }

  async create(profileId: string, input: CreatePrescriptionInput, actor: Actor) {
    const prescription = await this.prisma.$transaction(async (tx) => {
      const practitionerId = await this.resolvePractitioner(tx, profileId, input.practitionerName);
      const created = await tx.prescription.create({
        data: {
          patientProfileId: profileId,
          practitionerId,
          prescribedAt: input.prescribedAt,
          notes: input.notes,
        },
      });
      await writeAudit(tx, {
        action: "prescription.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "prescription",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
      return created;
    });
    return (await this.byId(profileId, prescription.id))!;
  }

  async list(profileId: string) {
    const prescriptions = await this.prisma.prescription.findMany({
      where: { patientProfileId: profileId, deletedAt: null },
      include: {
        practitioner: true,
        _count: { select: { documents: true, medications: true } },
      },
      // Newest visit first; a record with no date recorded falls back to when
      // it was filed rather than sinking to the bottom of the list forever.
      orderBy: [{ prescribedAt: "desc" }, { createdAt: "desc" }],
    });
    return prescriptions.map((p) => ({
      id: p.id,
      practitionerName: p.practitioner?.displayName ?? null,
      prescribedAt: p.prescribedAt?.toISOString().slice(0, 10) ?? null,
      notes: p.notes,
      documentCount: p._count.documents,
      medicationCount: p._count.medications,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async byId(profileId: string, id: string) {
    const prescription = await this.prisma.prescription.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: {
        practitioner: true,
        documents: { orderBy: { createdAt: "asc" }, include: { storedObject: { select: { status: true } } } },
        medications: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: { instructions: { where: { supersededAt: null }, take: 1 } },
        },
      },
    });
    if (!prescription) return null;
    return {
      id: prescription.id,
      practitionerName: prescription.practitioner?.displayName ?? null,
      prescribedAt: prescription.prescribedAt?.toISOString().slice(0, 10) ?? null,
      notes: prescription.notes,
      createdAt: prescription.createdAt.toISOString(),
      documents: prescription.documents.map((d) => ({
        id: d.id,
        kind: d.kind,
        status: d.status,
        // Only a verified object can actually be fetched — the UI uses this
        // to avoid offering a download link for an upload that never landed.
        downloadable: d.storedObject.status === "verified",
        createdAt: d.createdAt.toISOString(),
      })),
      medications: prescription.medications.map((m) => ({
        id: m.id,
        enteredName: m.enteredName,
        status: m.status,
        doseUnit: m.instructions[0]?.doseUnit ?? null,
      })),
    };
  }

  /**
   * Links an existing medication to this prescription as its evidence.
   * Separate from the medication's own update endpoint so the prescription
   * detail screen can do this without needing the medication's rowVersion.
   */
  async linkMedication(profileId: string, prescriptionId: string, medicationId: string, actor: Actor) {
    const prescription = await this.prisma.prescription.findFirst({
      where: { id: prescriptionId, patientProfileId: profileId, deletedAt: null },
    });
    if (!prescription) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Prescription not found", 404);
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id: medicationId, patientProfileId: profileId, deletedAt: null },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);

    await this.prisma.$transaction(async (tx) => {
      await tx.patientMedication.update({
        where: { id: medicationId },
        data: {
          prescriptionId,
          // Fills in the doctor only if the medicine doesn't already name one.
          ...(prescription.practitionerId && !medication.practitionerId ? { practitionerId: prescription.practitionerId } : {}),
        },
      });
      await tx.medicationChange.create({
        data: { patientMedicationId: medicationId, change: "updated", detail: { prescriptionLinked: true }, actorUserId: actor.userId },
      });
      await writeAudit(tx, {
        action: "medication.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "patient_medication",
        entityId: medicationId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { prescriptionLinked: true },
      });
    });
    return (await this.byId(profileId, prescriptionId))!;
  }

  /**
   * Soft-delete only (mirrors medications.controller.ts's softDelete). The
   * attached documents and linked medications deliberately keep their
   * `prescriptionId` — this app never cascades a soft-delete into child
   * rows, and docs/13 explicitly wants the uploaded original preserved while
   * a medication still references it. Reads simply stop surfacing the
   * deleted parent.
   */
  async softDelete(profileId: string, id: string, actor: Actor) {
    const prescription = await this.prisma.prescription.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!prescription) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Prescription not found", 404);
    await this.prisma.$transaction(async (tx) => {
      await tx.prescription.update({ where: { id }, data: { deletedAt: new Date() } });
      await writeAudit(tx, {
        action: "prescription.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "prescription",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }
}
