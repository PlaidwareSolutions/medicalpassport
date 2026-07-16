import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import type { CreateMedicationInput, UpdateMedicationInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

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
          startDate: input.startDate,
          endDate: input.endDate,
          isPrn: input.isPrn || input.instruction.frequencyCode === "SOS",
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

    // Stage 6 hook: queue safety evaluation on medication added (docs/09).
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
