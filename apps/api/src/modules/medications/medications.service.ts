import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { CLINICAL_CONTENT_KINDS, ERROR_CODES, type ClinicalContentKind, type Locale } from "@medpass/domain";
import type { CreateMedicationInput, RecordRefillInput, UpdateMedicationInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { PrismaService } from "../../common/prisma.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { SafetyEvaluationService } from "../safety/safety-evaluation.service";
import { ClinicalContentLookupService, CLINICAL_CONTENT_DTO_KEYS, type ClinicalContentEntry } from "../clinical-content/clinical-content-lookup.service";

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
  prescription: { include: { practitioner: true } },
  instructions: { where: { supersededAt: null }, orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;

/** Prisma transaction client — the subset these helpers actually use. */
type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

@Injectable()
export class MedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
    private readonly safety: SafetyEvaluationService,
    private readonly clinicalContent: ClinicalContentLookupService,
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
    const content = await this.loadClinicalContent(profileId, medications);
    return medications.map((m) => this.toDto(m, content));
  }

  async byId(profileId: string, id: string) {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: MEDICATION_INCLUDE,
    });
    if (!medication) return null;
    const content = await this.loadClinicalContent(profileId, [medication]);
    return this.toDto(medication, content);
  }

  /**
   * Batches lookups of every approved clinical-content kind (docs/07 screen
   * 19's separate labeled blocks) across every distinct ingredient/product
   * in the given medications — at most two extra queries per list()/byId()
   * call (via `ClinicalContentLookupService`), never one per medication (no
   * N+1). Single-ingredient products are looked up by ingredient;
   * combination products are looked up by product — never the union of
   * their ingredients' individual content, since that could imply something
   * never actually reviewed for that specific combination (docs/34). The
   * profile's own `preferredLocale` (not the viewing user's — a caregiver's
   * own UI language shouldn't determine what language the *patient's*
   * medical content shows in) prefers an approved translation when one
   * exists, always falling back to English otherwise.
   */
  private async loadClinicalContent(
    profileId: string,
    medications: Array<{ product: { id: string; isCombination: boolean; ingredients: Array<{ ingredient: { id: string } }> } | null }>,
  ): Promise<{
    byIngredientId: Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>;
    byProductId: Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>;
  }> {
    const ingredientIds = [
      ...new Set(
        medications
          .filter((m) => m.product && !m.product.isCombination)
          .flatMap((m) => m.product!.ingredients.map((i) => i.ingredient.id)),
      ),
    ];
    const productIds = [...new Set(medications.filter((m) => m.product?.isCombination).map((m) => m.product!.id))];
    const profile = await this.prisma.patientProfile.findUniqueOrThrow({ where: { id: profileId }, select: { preferredLocale: true } });
    const locale = profile.preferredLocale as Locale;
    const [byIngredientId, byProductId] = await Promise.all([
      this.clinicalContent.forIngredients(ingredientIds, CLINICAL_CONTENT_KINDS, locale),
      this.clinicalContent.forProducts(productIds, CLINICAL_CONTENT_KINDS, locale),
    ]);
    return { byIngredientId, byProductId };
  }

  /**
   * Resolves a typed prescriber name to a `Practitioner` row, reusing this
   * profile's existing record for the same name rather than inserting a
   * duplicate every time (which is what this did before — two medicines from
   * the same doctor produced two unrelated rows, making any per-doctor view
   * meaningless). An empty/whitespace-only name means "no prescriber": it
   * returns null to clear the link, rather than creating an unnamed record.
   */
  private async resolvePractitioner(tx: Tx, profileId: string, prescriberName: string): Promise<string | null> {
    const displayName = prescriberName.trim();
    if (!displayName) return null;
    const existing = await tx.practitioner.findFirst({
      where: { createdByProfileId: profileId, displayName: { equals: displayName, mode: "insensitive" }, deletedAt: null },
    });
    if (existing) return existing.id;
    const created = await tx.practitioner.create({ data: { displayName, createdByProfileId: profileId } });
    return created.id;
  }

  /** Confirms a prescription reference belongs to this profile before linking to it. */
  private async requirePrescription(tx: Tx, profileId: string, prescriptionId: string) {
    const prescription = await tx.prescription.findFirst({
      where: { id: prescriptionId, patientProfileId: profileId, deletedAt: null },
    });
    if (!prescription) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown prescription", 400);
    return prescription;
  }

  async create(profileId: string, input: CreateMedicationInput, actor: Actor) {
    // Normalization: a catalog selection is a confirmed match; free text stays
    // unmatched until the (Stage 6) normalization pipeline proposes a match.
    let enteredName = input.enteredName ?? "";
    let ingredientIds: string[] = [];
    let combinationProductId: string | undefined;
    if (input.productId) {
      const product = await this.prisma.medicationProduct.findFirst({
        where: { id: input.productId, status: "active" },
        include: { brand: true, ingredients: true },
      });
      if (!product) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown medicine selected", 400);
      enteredName = input.enteredName ?? product.brand?.name ?? product.genericName;
      ingredientIds = [...new Set(product.ingredients.map((i) => i.ingredientId))];
      // Product-keyed enrichment is capped at exactly 2 ingredients — a
      // 3-ingredient combination silently gets no product-level draft, the
      // correct, safe outcome (never a wrong guess). Its own ingredients'
      // individual content still gets enriched via the loop below either way.
      if (product.isCombination && ingredientIds.length === 2) combinationProductId = product.id;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const prescription = input.prescriptionId ? await this.requirePrescription(tx, profileId, input.prescriptionId) : null;

      // An explicitly typed prescriber always wins; otherwise a linked
      // prescription's own doctor carries over (its practitionerId is reused
      // directly, so linking can never mint a duplicate Practitioner row).
      let practitionerId: string | null = null;
      if (input.prescriberName !== undefined) {
        practitionerId = await this.resolvePractitioner(tx, profileId, input.prescriberName);
      } else if (prescription) {
        practitionerId = prescription.practitionerId;
      }

      const medication = await tx.patientMedication.create({
        data: {
          patientProfileId: profileId,
          productId: input.productId,
          enteredName,
          normalizationStatus: input.productId ? "confirmed" : "unmatched",
          patientReason: input.patientReason,
          practitionerId,
          prescriptionId: prescription?.id ?? null,
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
    // Clinical content enrichment (docs/13, docs/34 Gate 6/OD-6) — one job
    // per distinct ingredient, cached forever via jobKey regardless of how
    // many patients later add a medicine containing it. Only ever produces
    // a draft; nothing reaches a patient without a human reviewer's
    // approval. Trigger lives on create() only — a medication's catalog
    // link never changes on update().
    await this.enqueueContentEnrichment(ingredientIds, combinationProductId);
    return (await this.byId(profileId, created.id))!;
  }

  private async enqueueContentEnrichment(ingredientIds: string[], combinationProductId?: string): Promise<void> {
    for (const ingredientId of ingredientIds) {
      for (const kind of CLINICAL_CONTENT_KINDS) {
        const jobKey = `content-enrichment:${kind}:${ingredientId}`;
        const existingJob = await this.prisma.backgroundJob.findUnique({ where: { jobKey } });
        if (existingJob) continue;
        const existingContent = await this.prisma.clinicalContent.findUnique({
          where: { kind_ingredientId: { kind, ingredientId } },
        });
        if (existingContent) continue;
        await this.prisma.backgroundJob.create({
          data: { queue: "content_enrichment", jobKey, payload: { ingredientId, kind } },
        });
      }
    }
    if (!combinationProductId) return;
    for (const kind of CLINICAL_CONTENT_KINDS) {
      const jobKey = `content-enrichment:${kind}:product:${combinationProductId}`;
      const existingJob = await this.prisma.backgroundJob.findUnique({ where: { jobKey } });
      if (existingJob) continue;
      const existingContent = await this.prisma.clinicalContent.findUnique({
        where: { kind_productId: { kind, productId: combinationProductId } },
      });
      if (existingContent) continue;
      await this.prisma.backgroundJob.create({
        data: { queue: "content_enrichment", jobKey, payload: { productId: combinationProductId, kind } },
      });
    }
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
          ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
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
        // Clearing the field now genuinely unlinks. Previously any non-undefined
        // value — including the empty string a cleared input sends — created a
        // fresh Practitioner row, so clearing produced an unnamed record and
        // left the medicine still linked to a prescriber.
        const practitionerId = await this.resolvePractitioner(tx, profileId, input.prescriberName);
        await tx.patientMedication.update({ where: { id }, data: { practitionerId } });
      }

      if (input.prescriptionId !== undefined) {
        const prescription = input.prescriptionId ? await this.requirePrescription(tx, profileId, input.prescriptionId) : null;
        await tx.patientMedication.update({ where: { id }, data: { prescriptionId: prescription?.id ?? null } });
        // Linking to a prescription fills in its doctor only when the medicine
        // doesn't already have one — never overwrites what the patient typed.
        if (prescription?.practitionerId && input.prescriberName === undefined && !medication.practitionerId) {
          await tx.patientMedication.update({ where: { id }, data: { practitionerId: prescription.practitionerId } });
        }
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

    if (input.instruction || input.startDate !== undefined) {
      // A new confirmed instruction supersedes any existing schedule; a
      // changed startDate alone still needs regeneration too, since it's
      // the weekly/fortnightly/monthly anchor (SchedulingService).
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

  private toDto(
    m: {
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
      prescription: { id: string; prescribedAt: Date | null; deletedAt: Date | null; practitioner: { displayName: string } | null } | null;
      product:
        | ({
            id: string;
            genericName: string;
            strengthLabel: string | null;
            isCombination: boolean;
            brand: { name: string } | null;
            dosageForm: { name: string } | null;
            ingredients: Array<{ ingredient: { id: string; name: string }; strengthValue: unknown; strengthUnit: string | null }>;
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
    },
    content: {
      byIngredientId: Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>;
      byProductId: Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>;
    } = { byIngredientId: new Map(), byProductId: new Map() },
  ) {
    const instruction = m.instructions[0];
    const byKind = m.product
      ? m.product.isCombination
        ? content.byProductId.get(m.product.id)
        : content.byIngredientId.get(m.product.ingredients[0]?.ingredient.id ?? "")
      : undefined;
    const clinicalContent: Partial<Record<string, ClinicalContentEntry>> = {};
    if (byKind) {
      for (const kind of CLINICAL_CONTENT_KINDS) {
        const entry = byKind[kind];
        if (entry) clinicalContent[CLINICAL_CONTENT_DTO_KEYS[kind]] = entry;
      }
    }
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
      clinicalContent,
      patientReason: m.patientReason,
      prescriberName: m.practitioner?.displayName ?? null,
      // A soft-deleted prescription stops being surfaced as live evidence,
      // but the medicine's own row and its FK are left untouched (this app
      // never cascades a soft-delete into child rows).
      prescription:
        m.prescription && !m.prescription.deletedAt
          ? {
              id: m.prescription.id,
              prescribedAt: m.prescription.prescribedAt?.toISOString().slice(0, 10) ?? null,
              practitionerName: m.prescription.practitioner?.displayName ?? null,
            }
          : null,
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
