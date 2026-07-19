import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { CreateMedicationInput, RecordRefillInput, UpdateMedicationInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { SafetyEvaluationService } from "../safety/safety-evaluation.service";

interface Actor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

const MEDICATION_INCLUDE = {
  product: {
    include: {
      brand: true,
      dosageForm: true,
      ingredients: { include: { ingredient: true } },
    },
  },
  practitioner: true,
  instructions: { where: { supersededAt: null }, orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;

@Injectable()
export class MedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
    private readonly safety: SafetyEvaluationService,
  ) {}

  async list(profileId: string, status?: string) {
    const medications = await this.prisma.patientMedication.findMany({
      where: {
        patientProfileId: profileId,
        deletedAt: null,
        ...(status && ["current", "paused", "completed", "stopped", "unknown"].includes(status)
          ? { status: status as never }
          : {}),
      },
      include: MEDICATION_INCLUDE,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
    return medications.map((m) => this.toDto(m));
  }

  async byId(profileId: string, id: string) {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: MEDICATION_INCLUDE,
    });
    return medication ? this.toDto(medication) : null;
  }

  async create(profileId: string, input: CreateMedicationInput, actor: Actor) {
    // Normalization: a catalog selection is a confirmed match; free text stays
    // unmatched until the (Stage 6) normalization pipeline proposes a match.
    let enteredName = input.enteredName ?? "";
    if (input.productId) {
      const product = await this.prisma.medicationProduct.findFirst({
        where: { id: input.productId, status: "active" },
        include: { brand: true },
      });
      if (!product) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown medicine selected", 400);
      enteredName = input.enteredName ?? product.brand?.name ?? product.genericName;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      let practitionerId: string | undefined;
      if (input.prescriberName) {
        const practitioner = await tx.practitioner.create({
          data: { displayName: input.prescriberName, createdByProfileId: profileId },
        });
        practitionerId = practitioner.id;
      }

      const medication = await tx.patientMedication.create({
        data: {
          patientProfileId: profileId,
          productId: input.productId,
          enteredName,
          normalizationStatus: input.productId ? "confirmed" : "unmatched",
          patientReason: input.patientReason,
          practitionerId,
          source: input.source,
          // Defaults to today rather than staying null: a patient adding a
          // medicine is almost always starting it now or very recently, and
          // a real date (shown on doctor-visit mode, docs/07 screen 28, and
          // needed for completion reminders, screen 27) beats a blank one —
          // never a clinical fact, just a bookkeeping default the patient
          // can correct via edit if it's wrong.
          startDate: input.startDate ?? new Date(),
          endDate: input.endDate,
          isPrn: input.isPrn || input.instruction.frequencyCode === "SOS",
          quantityOnHand: input.quantityOnHand,
          criticalEscalation: input.criticalEscalation,
          instructions: {
            create: {
              doseQuantity: input.instruction.doseQuantity,
              doseUnit: input.instruction.doseUnit,
              frequencyCode: input.instruction.frequencyCode,
              pattern: input.instruction.pattern,
              foodInstruction: input.instruction.foodInstruction,
              durationDays: input.instruction.durationDays,
              originalText: input.instruction.originalText,
              confirmedByUserId: actor.userId,
            },
          },
        },
      });

      await tx.medicationChange.create({
        data: {
          patientMedicationId: medication.id,
          change: "created",
          detail: { source: input.source },
          actorUserId: actor.userId,
        },
      });
      await writeAudit(tx, {
        action: "medication.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "patient_medication",
        entityId: medication.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { source: input.source, normalized: Boolean(input.productId) },
      });
      return medication;
    });

    // Derive the daily schedule from the confirmed instruction, if any
    // (docs/16). No-op for PRN medicines and non-auto-schedulable patterns.
    await this.scheduling.regenerateForMedication(created.id);
    // Safety review runs on every medication add (docs/09).
    await this.safety.evaluate(profileId, "medication_added");
    return (await this.byId(profileId, created.id))!;
  }

  async update(profileId: string, id: string, input: UpdateMedicationInput, actor: Actor) {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.patientMedication.updateMany({
        where: { id, rowVersion: input.rowVersion },
        data: {
          ...(input.patientReason !== undefined ? { patientReason: input.patientReason } : {}),
          ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
          ...(input.quantityOnHand !== undefined ? { quantityOnHand: input.quantityOnHand } : {}),
          ...(input.criticalEscalation !== undefined ? { criticalEscalation: input.criticalEscalation } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        throw new ApiProblem(ERROR_CODES.CONFLICT_ROW_VERSION, "This medicine was changed elsewhere. Reload and retry.", 409);
      }

      if (input.prescriberName !== undefined) {
        const practitioner = await tx.practitioner.create({
          data: { displayName: input.prescriberName, createdByProfileId: profileId },
        });
        await tx.patientMedication.update({ where: { id }, data: { practitionerId: practitioner.id } });
      }

      if (input.instruction) {
        // Instructions are copy-on-write: supersede, never overwrite (docs/13).
        await tx.medicationInstruction.updateMany({
          where: { patientMedicationId: id, supersededAt: null },
          data: { supersededAt: new Date() },
        });
        await tx.medicationInstruction.create({
          data: {
            patientMedicationId: id,
            doseQuantity: input.instruction.doseQuantity,
            doseUnit: input.instruction.doseUnit,
            frequencyCode: input.instruction.frequencyCode,
            pattern: input.instruction.pattern,
            foodInstruction: input.instruction.foodInstruction,
            durationDays: input.instruction.durationDays,
            originalText: input.instruction.originalText,
            confirmedByUserId: actor.userId,
          },
        });
      }

      await tx.medicationChange.create({
        data: {
          patientMedicationId: id,
          change: "updated",
          detail: { fields: Object.keys(input).filter((k) => k !== "rowVersion") },
          actorUserId: actor.userId,
        },
      });
      await writeAudit(tx, {
        action: "medication.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "patient_medication",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { fields: Object.keys(input).filter((k) => k !== "rowVersion") },
      });
    });

    if (input.instruction) {
      // A new confirmed instruction supersedes any existing schedule.
      await this.scheduling.regenerateForMedication(id);
      // "Medication changes" is itself a safety re-evaluation trigger
      // (docs/09) — a changed dose/frequency is exactly what
      // dose_differs_from_prescription and schedule_conflict check for.
      await this.safety.evaluate(profileId, "medication_updated");
    }
    return (await this.byId(profileId, id))!;
  }

  /**
   * "Mark refilled" (docs/07 screen 27) — a semantically distinct event from
   * a plain quantity edit, with its own audit action, since it's the answer
   * to a refill reminder rather than an incidental correction. Resolves any
   * outstanding refill reminders for this medication the same way recording
   * a dose resolves a dose reminder (docs/16 — acknowledgement from any
   * surface resolves the reminder everywhere).
   */
  async recordRefill(profileId: string, id: string, input: RecordRefillInput, actor: Actor) {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);

    const { quantityOnHand } = input;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.patientMedication.updateMany({
        where: { id, rowVersion: input.rowVersion },
        data: { quantityOnHand, rowVersion: { increment: 1 } },
      });
      if (updated.count === 0) {
        throw new ApiProblem(ERROR_CODES.CONFLICT_ROW_VERSION, "This medicine was changed elsewhere. Reload and retry.", 409);
      }
      await tx.medicationChange.create({
        data: { patientMedicationId: id, change: "refilled", detail: { quantityOnHand }, actorUserId: actor.userId },
      });
      await writeAudit(tx, {
        action: "medication.refill_recorded",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "patient_medication",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
      await tx.notification.updateMany({
        where: { patientMedicationId: id, kind: "refill", status: { in: ["pending", "done"] } },
        data: { status: "cancelled" },
      });
    });
    return (await this.byId(profileId, id))!;
  }

  private toDto(m: {
    id: string;
    enteredName: string;
    patientReason: string | null;
    status: string;
    isPrn: boolean;
    startDate: Date | null;
    endDate: Date | null;
    quantityOnHand: unknown;
    criticalEscalation: boolean;
    rowVersion: number;
    normalizationStatus: string;
    createdAt: Date;
    practitioner: { displayName: string } | null;
    product:
      | ({
          id: string;
          genericName: string;
          strengthLabel: string | null;
          isCombination: boolean;
          brand: { name: string } | null;
          dosageForm: { name: string } | null;
          ingredients: Array<{ ingredient: { name: string }; strengthValue: unknown; strengthUnit: string | null }>;
        })
      | null;
    instructions: Array<{
      doseQuantity: unknown;
      doseUnit: string;
      frequencyCode: string;
      pattern: string | null;
      foodInstruction: string;
      durationDays: number | null;
    }>;
  }) {
    const instruction = m.instructions[0];
    return {
      id: m.id,
      enteredName: m.enteredName,
      normalizationStatus: m.normalizationStatus,
      product: m.product
        ? {
            id: m.product.id,
            brandName: m.product.brand?.name ?? null,
            genericName: m.product.genericName,
            strengthLabel: m.product.strengthLabel,
            form: m.product.dosageForm?.name ?? null,
            isCombination: m.product.isCombination,
            ingredients: m.product.ingredients.map((i) => ({
              name: i.ingredient.name,
              strength: i.strengthValue != null ? `${i.strengthValue} ${i.strengthUnit ?? ""}`.trim() : null,
            })),
          }
        : null,
      patientReason: m.patientReason,
      prescriberName: m.practitioner?.displayName ?? null,
      status: m.status,
      isPrn: m.isPrn,
      startDate: m.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: m.endDate?.toISOString().slice(0, 10) ?? null,
      quantityOnHand: m.quantityOnHand != null ? String(m.quantityOnHand) : null,
      criticalEscalation: m.criticalEscalation,
      rowVersion: m.rowVersion,
      instruction: instruction
        ? {
            doseQuantity: String(instruction.doseQuantity),
            doseUnit: instruction.doseUnit,
            frequencyCode: instruction.frequencyCode,
            pattern: instruction.pattern,
            foodInstruction: instruction.foodInstruction,
            durationDays: instruction.durationDays,
          }
        : null,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
