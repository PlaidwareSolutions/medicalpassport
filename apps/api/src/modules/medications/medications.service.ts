import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { CLINICAL_CONTENT_KINDS, ERROR_CODES, type ClinicalContentKind, type Locale } from "@medpass/domain";
import type {
  CreateMedicationInput,
  PutRefillPlanInput,
  RecordRefillInput,
  StartMedicationFromItemInput,
  UpdateMedicationInput,
} from "@medpass/validation";
import type { Prescription, PrescriptionItem } from "@medpass/database";
import { ApiProblem } from "../../common/errors";
import { emitMedicationChangeEvent } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import { stampProvenanceFor, type ProvenanceActor } from "../../common/provenance-actor";
import { PractitionersService } from "../practitioners/practitioners.service";
import { SchedulingService } from "../scheduling/scheduling.service";
import { SafetyEvaluationService } from "../safety/safety-evaluation.service";
import { ClinicalContentLookupService, CLINICAL_CONTENT_DTO_KEYS, type ClinicalContentEntry } from "../clinical-content/clinical-content-lookup.service";
import { readRefillPlan, syncRefillPlan, type RefillPlanView } from "./refill-plan";

interface Actor extends ProvenanceActor {
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
  refillPlan: { select: { packSize: true, dailyConsumption: true, projectedRunOutOn: true } },
} as const;

/** Labels for the Phase 2 links (`reasonConditionId`, `prescribingPractitionerId`), batched per list()/byId() call. */
interface LinkLabels {
  conditions: Map<string, string>;
  practitioners: Map<string, string>;
}

/** Prisma transaction client — the subset these helpers actually use. */
type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

@Injectable()
export class MedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduling: SchedulingService,
    private readonly safety: SafetyEvaluationService,
    private readonly clinicalContent: ClinicalContentLookupService,
    private readonly practitioners: PractitionersService,
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
    const [content, links] = await Promise.all([this.loadClinicalContent(profileId, medications), this.loadLinkLabels(profileId, medications)]);
    return medications.map((m) => this.toDto(m, content, links));
  }

  async byId(profileId: string, id: string) {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: MEDICATION_INCLUDE,
    });
    if (!medication) return null;
    const [content, links] = await Promise.all([this.loadClinicalContent(profileId, [medication]), this.loadLinkLabels(profileId, [medication])]);
    return this.toDto(medication, content, links);
  }

  /** Two queries at most per list()/byId() — never one per medicine — and scoped to this profile's own rows. */
  private async loadLinkLabels(
    profileId: string,
    medications: Array<{ reasonConditionId: string | null; prescribingPractitionerId: string | null }>,
  ): Promise<LinkLabels> {
    const conditionIds = [...new Set(medications.map((m) => m.reasonConditionId).filter((v): v is string => !!v))];
    const practitionerIds = [...new Set(medications.map((m) => m.prescribingPractitionerId).filter((v): v is string => !!v))];
    const [conditions, practitioners] = await Promise.all([
      // Soft-deleted rows are excluded deliberately: a medicine keeps its FK
      // (this app never cascades a soft-delete), but a deleted condition or
      // doctor must stop being surfaced as a live link — the same rule the
      // prescription evidence above follows.
      conditionIds.length
        ? this.prisma.patientCondition.findMany({
            where: { id: { in: conditionIds }, patientProfileId: profileId, deletedAt: null },
            select: { id: true, label: true },
          })
        : [],
      practitionerIds.length
        ? this.prisma.practitioner.findMany({
            where: { id: { in: practitionerIds }, createdByProfileId: profileId, deletedAt: null },
            select: { id: true, displayName: true },
          })
        : [],
    ]);
    return {
      conditions: new Map(conditions.map((c) => [c.id, c.label])),
      practitioners: new Map(practitioners.map((p) => [p.id, p.displayName])),
    };
  }

  /** `reasonConditionId` must be one of this profile's (non-deleted) conditions — a foreign id is a 400, never a silent link. */
  private async requireCondition(tx: Tx, profileId: string, conditionId: string) {
    const condition = await tx.patientCondition.findFirst({ where: { id: conditionId, patientProfileId: profileId, deletedAt: null } });
    if (!condition) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown condition", 400, [
        { path: "reasonConditionId", message: "Not one of this profile's conditions" },
      ]);
    }
    return condition;
  }

  /** `prescribingPractitionerId` must be one of this profile's own doctors. */
  private async requirePractitioner(tx: Tx, profileId: string, practitionerId: string) {
    const practitioner = await tx.practitioner.findFirst({ where: { id: practitionerId, createdByProfileId: profileId, deletedAt: null } });
    if (!practitioner) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Unknown doctor", 400, [
        { path: "prescribingPractitionerId", message: "Not one of this profile's doctors" },
      ]);
    }
    return practitioner;
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
        practitionerId = await this.practitioners.resolve(tx, profileId, input.prescriberName);
      } else if (prescription) {
        practitionerId = prescription.practitionerId;
      }

      // Provenance (ADR-V2-002): a medicine confirmed off an extraction
      // candidate is OCR-derived and starts unverified; anything typed by
      // the person saving it is user/caregiver-entered and patient-confirmed.
      const provenance = stampProvenanceFor(actor, { source: input.source === "extraction" ? "ocr_extracted" : undefined });

      const medication = await tx.patientMedication.create({
        data: {
          ...provenance,
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
              // Every client path reaching here now presents a medicine-type
              // picker, so the unit is a real choice rather than a default.
              doseUnitConfirmedAt: new Date(),
              ...provenance,
            },
          },
        },
      });

      const change = await tx.medicationChange.create({
        data: {
          patientMedicationId: medication.id,
          change: "created",
          detail: { source: input.source },
          actorUserId: actor.userId,
        },
      });
      await emitMedicationChangeEvent(tx, { profileId, actorType: actor.actorRole, medication, change });
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

  /**
   * Records the patient's answer to "what kind of medicine is this?" for a
   * medication whose unit the app once defaulted (docs/07 screen 9).
   *
   * Two different things can happen, and they're treated differently on
   * purpose. Confirming the unit that's already stored changes no clinical
   * value, so it just stamps the existing instruction — creating a superseding
   * copy identical in every field would pad the history with a non-event.
   * Correcting it to a different unit *is* a change to how the dose reads, so
   * it goes through the same copy-on-write supersede the edit screen uses and
   * leaves the old row intact (docs/13).
   */
  async confirmDoseUnit(profileId: string, id: string, doseUnit: string, actor: Actor) {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      include: { instructions: { where: { supersededAt: null }, take: 1 } },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);
    const current = medication.instructions[0];
    if (!current) throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This medicine has no instructions to confirm", 400);

    const corrected = current.doseUnit !== doseUnit;
    await this.prisma.$transaction(async (tx) => {
      if (corrected) {
        await tx.medicationInstruction.update({ where: { id: current.id }, data: { supersededAt: new Date() } });
        await tx.medicationInstruction.create({
          data: {
            patientMedicationId: id,
            doseQuantity: current.doseQuantity,
            doseUnit,
            frequencyCode: current.frequencyCode,
            pattern: current.pattern,
            foodInstruction: current.foodInstruction,
            durationDays: current.durationDays,
            originalText: current.originalText,
            confirmedByUserId: actor.userId,
            doseUnitConfirmedAt: new Date(),
            ...stampProvenanceFor(actor),
          },
        });
        // A corrected unit changes how the dose reads, so it is a real entry
        // in the medicine's history and on the timeline; a plain confirmation
        // (below) is not.
        const change = await tx.medicationChange.create({
          data: {
            patientMedicationId: id,
            change: "dose_unit_confirmed",
            detail: { from: current.doseUnit, to: doseUnit },
            actorUserId: actor.userId,
          },
        });
        await emitMedicationChangeEvent(tx, { profileId, actorType: actor.actorRole, medication, change });
      } else {
        await tx.medicationInstruction.update({
          where: { id: current.id },
          data: { doseUnitConfirmedAt: new Date() },
        });
      }
      await writeAudit(tx, {
        action: "medication.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "patient_medication",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { field: "dose_unit", confirmed: doseUnit, corrected },
      });
    });

    return (await this.byId(profileId, id))!;
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
          // Phase 2 links (docs_v2/04 §4.1). Each id is checked to belong to
          // this profile first, so a foreign id is a 400, never a silent link.
          ...(input.reasonConditionId !== undefined
            ? { reasonConditionId: input.reasonConditionId ? (await this.requireCondition(tx, profileId, input.reasonConditionId)).id : null }
            : {}),
          ...(input.prescribingPractitionerId !== undefined
            ? {
                prescribingPractitionerId: input.prescribingPractitionerId
                  ? (await this.requirePractitioner(tx, profileId, input.prescribingPractitionerId)).id
                  : null,
              }
            : {}),
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
        const practitionerId = await this.practitioners.resolve(tx, profileId, input.prescriberName);
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

      // Phase 2 (docs_v2/04 §4.1) adds three fields that live on the
      // instruction rather than the medicine. Sent alongside a full
      // instruction they override its matching field; sent alone they still
      // supersede, because an instruction row is never edited in place —
      // the medication history has to keep showing what was true before.
      const instructionOnlyFields =
        input.routeText !== undefined || input.strengthLabel !== undefined || input.stopPlannedAt !== undefined;
      if (input.instruction || instructionOnlyFields) {
        const current = await tx.medicationInstruction.findFirst({
          where: { patientMedicationId: id, supersededAt: null },
          orderBy: { createdAt: "desc" },
        });
        // Instructions are copy-on-write: supersede, never overwrite (docs/13).
        await tx.medicationInstruction.updateMany({
          where: { patientMedicationId: id, supersededAt: null },
          data: { supersededAt: new Date() },
        });
        const base = input.instruction ?? current;
        if (!base) {
          throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This medicine has no instruction to change yet", 400, [
            { path: "instruction", message: "Send the full instruction the first time" },
          ]);
        }
        await tx.medicationInstruction.create({
          data: {
            patientMedicationId: id,
            doseQuantity: base.doseQuantity,
            doseUnit: base.doseUnit,
            frequencyCode: base.frequencyCode,
            pattern: base.pattern,
            foodInstruction: base.foodInstruction,
            durationDays: input.instruction?.durationDays ?? base.durationDays,
            originalText: input.instruction?.originalText ?? ("originalText" in base ? base.originalText : null),
            ...(input.routeText !== undefined ? { routeText: input.routeText } : { routeText: current?.routeText ?? null }),
            ...(input.strengthLabel !== undefined
              ? { strengthLabel: input.strengthLabel }
              : { strengthLabel: current?.strengthLabel ?? null }),
            ...(input.stopPlannedAt !== undefined
              ? { stopPlannedAt: input.stopPlannedAt }
              : { stopPlannedAt: current?.stopPlannedAt ?? null }),
            confirmedByUserId: actor.userId,
            doseUnitConfirmedAt: new Date(),
            ...stampProvenanceFor(actor),
          },
        });
      }

      const change = await tx.medicationChange.create({
        data: {
          patientMedicationId: id,
          change: "updated",
          detail: { fields: Object.keys(input).filter((k) => k !== "rowVersion") },
          actorUserId: actor.userId,
        },
      });
      await emitMedicationChangeEvent(tx, { profileId, actorType: actor.actorRole, medication, change });
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
   * Refill plan (docs_v2/05 §4). Reading never creates a row: a patient who
   * has only ever used the bare counter still gets a projection, with
   * `exists: false` so the client can offer to set a pack size.
   */
  async getRefillPlan(profileId: string, id: string): Promise<RefillPlanView> {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      select: { id: true },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);
    return readRefillPlan(this.prisma, id);
  }

  /**
   * Writes the plan and pushes the same quantity back onto the medication
   * row, so the two never disagree while `quantityOnHand` still exists.
   */
  async putRefillPlan(profileId: string, id: string, input: PutRefillPlanInput, actor: Actor): Promise<RefillPlanView> {
    const medication = await this.prisma.patientMedication.findFirst({
      where: { id, patientProfileId: profileId, deletedAt: null },
      select: { id: true },
    });
    if (!medication) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Medicine not found", 404);

    await this.prisma.$transaction(async (tx) => {
      if (input.quantityOnHand !== undefined) {
        await tx.patientMedication.update({
          where: { id },
          data: { quantityOnHand: input.quantityOnHand, rowVersion: { increment: 1 } },
        });
      }
      await syncRefillPlan(tx, id, {
        create: true,
        ...(input.packSize !== undefined ? { packSize: input.packSize } : {}),
        recordedByUserId: actor.userId,
      });
      await writeAudit(tx, {
        action: "medication.refill_plan_updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "patient_medication",
        entityId: id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        // Counts and flags only — never the quantity itself.
        context: { setPackSize: input.packSize != null, setQuantity: input.quantityOnHand != null },
      });
    });
    return readRefillPlan(this.prisma, id);
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
      // The medicine row stays the writer of record for the counter; the
      // plan mirrors it so its projection reflects the refill immediately.
      await syncRefillPlan(tx, id);
      const change = await tx.medicationChange.create({
        data: { patientMedicationId: id, change: "refilled", detail: { quantityOnHand }, actorUserId: actor.userId },
      });
      await emitMedicationChangeEvent(tx, { profileId, actorType: actor.actorRole, medication, change });
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
      /** Phase 2 links (docs_v2/04 §4.1) — labels resolved through `links`, never a per-row query. */
      reasonConditionId: string | null;
      prescribingPractitionerId: string | null;
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
        doseUnitConfirmedAt: Date | null;
      }>;
    },
    content: {
      byIngredientId: Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>;
      byProductId: Map<string, Partial<Record<ClinicalContentKind, ClinicalContentEntry>>>;
    } = { byIngredientId: new Map(), byProductId: new Map() },
    links: LinkLabels = { conditions: new Map(), practitioners: new Map() },
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
      // Phase 2 (docs_v2/04 §4.1): "why am I taking it" as a link to the
      // patient's own condition, and who prescribed it, alongside — never
      // instead of — the free-text reason the patient wrote themselves.
      // A label missing from `links` means the row was deleted or belongs to
      // another profile; the id is then dropped rather than shown bare.
      reasonCondition:
        m.reasonConditionId && links.conditions.has(m.reasonConditionId)
          ? { id: m.reasonConditionId, label: links.conditions.get(m.reasonConditionId)! }
          : null,
      prescribingPractitioner:
        m.prescribingPractitionerId && links.practitioners.has(m.prescribingPractitionerId)
          ? { id: m.prescribingPractitionerId, displayName: links.practitioners.get(m.prescribingPractitionerId)! }
          : null,
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
            // False only for instructions written before every client path
            // offered a medicine-type picker — the app defaulted "tablet"
            // then, so the UI must ask rather than draw a guessed glyph.
            doseUnitConfirmed: instruction.doseUnitConfirmedAt != null,
          }
        : null,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
