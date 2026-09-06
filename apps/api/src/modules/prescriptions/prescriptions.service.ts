import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { ERROR_CODES } from "@medpass/domain";
import { emitHealthEvent, projectPrescription, supersedeHealthEvents } from "@medpass/health-events";
import type {
  CreatePrescriptionInput,
  PrescriptionItemInput,
  StartMedicationFromItemInput,
  UpdatePrescriptionItemInput,
} from "@medpass/validation";
import type { PrescriptionItem } from "@medpass/database";
import { ApiProblem } from "../../common/errors";
import { emitMedicationChangeEvent, eventCtx } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import { stampProvenanceFor, type ProvenanceActor } from "../../common/provenance-actor";
import { EncountersService } from "../encounters/encounters.service";
import { MedicationsService } from "../medications/medications.service";
import { queueCaregiverNotification } from "../notifications/caregiver-notifications";
import { PractitionersService } from "../practitioners/practitioners.service";

interface Actor extends ProvenanceActor {
  correlationId?: string;
}

/** Prisma transaction client — the subset this service actually uses. */
type Tx = Parameters<Parameters<PrismaService["$transaction"]>[0]>[0];

/**
 * A line as written on the prescription (docs_v2/04 §4.1). `startedMedicationId`
 * is what tells the UI whether this line has become one of the patient's
 * medicines yet — a line can be prescribed and never started, which is a
 * normal outcome, not an incomplete record.
 */
function toItemDto(i: PrescriptionItem) {
  return {
    id: i.id,
    sequence: i.sequence,
    enteredName: i.enteredName,
    productId: i.productId,
    strengthLabel: i.strengthLabel,
    formText: i.formText,
    routeText: i.routeText,
    doseQuantity: i.doseQuantity == null ? null : String(i.doseQuantity),
    doseUnit: i.doseUnit,
    frequencyCode: i.frequencyCode,
    pattern: i.pattern,
    foodInstruction: i.foodInstruction,
    durationDays: i.durationDays,
    instructionsText: i.instructionsText,
    startedMedicationId: i.startedMedicationId,
    provenanceSource: i.provenanceSource,
    verification: i.verification,
  };
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly practitioners: PractitionersService,
    private readonly medications: MedicationsService,
  ) {}

  async create(profileId: string, input: CreatePrescriptionInput, actor: Actor) {
    const prescription = await this.prisma.$transaction(async (tx) => {
      const practitionerId = await this.practitioners.resolve(tx, profileId, input.practitionerName);
      if (input.encounterId) await EncountersService.requireEncounter(tx, profileId, input.encounterId);
      const created = await tx.prescription.create({
        data: {
          patientProfileId: profileId,
          practitionerId,
          prescribedAt: input.prescribedAt,
          notes: input.notes,
          encounterId: input.encounterId ?? null,
          diagnosisText: input.diagnosisText ?? null,
          validUntil: input.validUntil ?? null,
          followUpOn: input.followUpOn ?? null,
          ...stampProvenanceFor(actor),
        },
        include: { practitioner: { select: { displayName: true } } },
      });

      // Line items as written on the paper (docs_v2/04 §4.1). These are not
      // the patient's medicines: a line can be prescribed and never started.
      // Sequence follows the order sent, which is the order on the page.
      if (input.items?.length) {
        await tx.prescriptionItem.createMany({
          data: input.items.map((item, index) => ({
            prescriptionId: created.id,
            patientProfileId: profileId,
            sequence: item.sequence ?? index + 1,
            enteredName: item.enteredName,
            productId: item.productId ?? null,
            strengthLabel: item.strengthLabel ?? null,
            formText: item.formText ?? null,
            routeText: item.routeText ?? null,
            doseQuantity: item.doseQuantity ?? null,
            doseUnit: item.doseUnit ?? null,
            frequencyCode: item.frequencyCode ?? null,
            pattern: item.pattern ?? null,
            foodInstruction: item.foodInstruction ?? null,
            durationDays: item.durationDays ?? null,
            instructionsText: item.instructionsText ?? null,
            ...stampProvenanceFor(actor),
          })),
        });
      }
      await writeAudit(tx, {
        action: "prescription.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "prescription",
        entityId: created.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
      await emitHealthEvent(
        tx,
        projectPrescription(await eventCtx(tx, profileId, actor), {
          ...created,
          practitionerName: created.practitioner?.displayName ?? null,
          medicineCount: 0,
        }),
      );
      // Caregivers who can see the medicines list are told a prescription
      // arrived (docs_v2/06 P6-4) — never the person who filed it.
      await queueCaregiverNotification(tx, {
        patientProfileId: profileId,
        kind: "new_prescription",
        entityId: created.id,
        triggeredByUserId: actor.userId,
        triggeredByRole: actor.actorRole,
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
        // A failed upload's stub (marked deleted by cleanup-abandoned-uploads)
        // and a deleted medicine must not inflate the list's counts — the
        // broken-CORS era proved a "1 file(s)" chip over a dead stub reads
        // as a duplicate record, not as debris.
        _count: {
          select: {
            documents: { where: { status: { not: "deleted" } } },
            medications: { where: { deletedAt: null } },
          },
        },
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
      encounterId: p.encounterId,
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
        documents: {
          where: { status: { not: "deleted" } },
          orderBy: { createdAt: "asc" },
          include: { storedObject: { select: { status: true } } },
        },
        medications: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: { instructions: { where: { supersededAt: null }, take: 1 } },
        },
        items: { where: { deletedAt: null }, orderBy: { sequence: "asc" } },
      },
    });
    if (!prescription) return null;
    return {
      id: prescription.id,
      practitionerName: prescription.practitioner?.displayName ?? null,
      prescribedAt: prescription.prescribedAt?.toISOString().slice(0, 10) ?? null,
      notes: prescription.notes,
      encounterId: prescription.encounterId,
      diagnosisText: prescription.diagnosisText,
      validUntil: prescription.validUntil?.toISOString().slice(0, 10) ?? null,
      followUpOn: prescription.followUpOn?.toISOString().slice(0, 10) ?? null,
      items: prescription.items.map((i) => toItemDto(i)),
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

  /** Line items as written on the paper, in page order. */
  async listItems(profileId: string, prescriptionId: string) {
    await this.requireOwnPrescription(this.prisma, profileId, prescriptionId);
    const items = await this.prisma.prescriptionItem.findMany({
      where: { prescriptionId, deletedAt: null },
      orderBy: { sequence: "asc" },
    });
    return items.map(toItemDto);
  }

  async addItem(profileId: string, prescriptionId: string, input: PrescriptionItemInput, actor: Actor) {
    await this.requireOwnPrescription(this.prisma, profileId, prescriptionId);
    const created = await this.prisma.$transaction(async (tx) => {
      // Appended to the end of the page unless the caller places it.
      const last = await tx.prescriptionItem.findFirst({
        where: { prescriptionId, deletedAt: null },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      const item = await tx.prescriptionItem.create({
        data: {
          prescriptionId,
          patientProfileId: profileId,
          sequence: input.sequence ?? (last?.sequence ?? 0) + 1,
          enteredName: input.enteredName,
          productId: input.productId ?? null,
          strengthLabel: input.strengthLabel ?? null,
          formText: input.formText ?? null,
          routeText: input.routeText ?? null,
          doseQuantity: input.doseQuantity ?? null,
          doseUnit: input.doseUnit ?? null,
          frequencyCode: input.frequencyCode ?? null,
          pattern: input.pattern ?? null,
          foodInstruction: input.foodInstruction ?? null,
          durationDays: input.durationDays ?? null,
          instructionsText: input.instructionsText ?? null,
          ...stampProvenanceFor(actor),
        },
      });
      await writeAudit(tx, {
        action: "prescription_item.created",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "prescription_item",
        entityId: item.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
      return item;
    });
    return toItemDto(created);
  }

  async updateItem(profileId: string, itemId: string, input: UpdatePrescriptionItemInput, actor: Actor) {
    const existing = await this.requireOwnItem(profileId, itemId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const item = await tx.prescriptionItem.update({
        where: { id: existing.id },
        data: {
          ...(input.enteredName !== undefined ? { enteredName: input.enteredName } : {}),
          ...(input.productId !== undefined ? { productId: input.productId } : {}),
          ...(input.strengthLabel !== undefined ? { strengthLabel: input.strengthLabel } : {}),
          ...(input.formText !== undefined ? { formText: input.formText } : {}),
          ...(input.routeText !== undefined ? { routeText: input.routeText } : {}),
          ...(input.doseQuantity !== undefined ? { doseQuantity: input.doseQuantity } : {}),
          ...(input.doseUnit !== undefined ? { doseUnit: input.doseUnit } : {}),
          ...(input.frequencyCode !== undefined ? { frequencyCode: input.frequencyCode } : {}),
          ...(input.pattern !== undefined ? { pattern: input.pattern } : {}),
          ...(input.foodInstruction !== undefined ? { foodInstruction: input.foodInstruction } : {}),
          ...(input.durationDays !== undefined ? { durationDays: input.durationDays } : {}),
          ...(input.instructionsText !== undefined ? { instructionsText: input.instructionsText } : {}),
          ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
        },
      });
      await writeAudit(tx, {
        action: "prescription_item.updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "prescription_item",
        entityId: item.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { fields: Object.keys(input) },
      });
      return item;
    });
    return toItemDto(updated);
  }

  async deleteItem(profileId: string, itemId: string, actor: Actor) {
    const existing = await this.requireOwnItem(profileId, itemId);
    await this.prisma.$transaction(async (tx) => {
      await tx.prescriptionItem.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
      await writeAudit(tx, {
        action: "prescription_item.deleted",
        actorUserId: actor.userId,
        actorType: actor.actorRole,
        entityType: "prescription_item",
        entityId: existing.id,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
      });
    });
  }

  /**
   * "Start this medicine" from a line (docs_v2/05 §4). The line's own
   * dose/frequency/food carry over; the override supplies whatever the paper
   * left out. A line with no dose and no override is refused rather than
   * guessed — starting a medicine on an invented dose is hazard H-02.
   *
   * Delegates the actual creation to MedicationsService so a medicine started
   * this way is identical to one added by hand: same normalization, same
   * schedule generation, same safety re-evaluation, same change history.
   */
  async startMedicationFromItem(profileId: string, itemId: string, input: StartMedicationFromItemInput, actor: Actor) {
    const item = await this.requireOwnItem(profileId, itemId);
    if (item.startedMedicationId) {
      const live = await this.prisma.patientMedication.findFirst({
        where: { id: item.startedMedicationId, deletedAt: null },
        select: { id: true },
      });
      if (live) {
        throw new ApiProblem(ERROR_CODES.CONFLICT_ROW_VERSION, "This line has already been started as a medicine", 409);
      }
    }

    const doseQuantity = input.doseQuantity ?? (item.doseQuantity == null ? undefined : Number(item.doseQuantity));
    const doseUnit = input.doseUnit ?? item.doseUnit ?? undefined;
    const frequencyCode = input.frequencyCode ?? item.frequencyCode ?? undefined;
    const pattern = input.pattern ?? item.pattern ?? undefined;
    const foodInstruction = input.foodInstruction ?? item.foodInstruction ?? undefined;

    const missing: Array<{ path: string; message: string }> = [];
    if (doseQuantity == null) missing.push({ path: "doseQuantity", message: "The prescription didn't say how much — choose the dose" });
    if (!doseUnit) missing.push({ path: "doseUnit", message: "Choose the medicine type" });
    if (!frequencyCode) missing.push({ path: "frequencyCode", message: "The prescription didn't say how often — choose it" });
    if (frequencyCode === "PATTERN" && !pattern) missing.push({ path: "pattern", message: "Pattern (e.g. 1-0-1) is required" });
    if (missing.length > 0) {
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This line needs a dose before it can be started", 400, missing);
    }

    const medication = await this.medications.create(
      profileId,
      {
        enteredName: item.enteredName,
        productId: item.productId ?? undefined,
        prescriptionId: item.prescriptionId,
        source: "previous",
        isPrn: false,
        criticalEscalation: false,
        startDate: input.startDate,
        quantityOnHand: input.quantityOnHand,
        patientReason: input.patientReason,
        instruction: {
          doseQuantity: doseQuantity!,
          doseUnit: doseUnit!,
          frequencyCode: frequencyCode!,
          pattern,
          foodInstruction: foodInstruction ?? "any",
          durationDays: item.durationDays ?? undefined,
          originalText: item.instructionsText ?? undefined,
          routeText: item.routeText,
          strengthLabel: item.strengthLabel,
        },
      } as never,
      actor,
    );

    await this.prisma.prescriptionItem.update({ where: { id: item.id }, data: { startedMedicationId: medication.id } });
    return medication;
  }

  private async requireOwnPrescription(tx: Tx | PrismaService, profileId: string, prescriptionId: string) {
    const prescription = await tx.prescription.findFirst({
      where: { id: prescriptionId, patientProfileId: profileId, deletedAt: null },
    });
    if (!prescription) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Prescription not found", 404);
    return prescription;
  }

  /** A line is reachable only through its own profile — a foreign id is a 404, never a peek. */
  private async requireOwnItem(profileId: string, itemId: string) {
    const item = await this.prisma.prescriptionItem.findFirst({
      where: { id: itemId, patientProfileId: profileId, deletedAt: null },
    });
    if (!item) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Prescription line not found", 404);
    return item;
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
      const change = await tx.medicationChange.create({
        data: { patientMedicationId: medicationId, change: "updated", detail: { prescriptionLinked: true }, actorUserId: actor.userId },
      });
      await emitMedicationChangeEvent(tx, { profileId, actorType: actor.actorRole, medication, change });
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
      await supersedeHealthEvents(tx, "prescription", id);
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
