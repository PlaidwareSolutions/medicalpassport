import { writeAudit } from "@medpass/audit";
import { ERROR_CODES, type FoodInstruction, type FrequencyCode } from "@medpass/domain";
import type { Prisma, PrismaClient } from "@medpass/database";
import {
  emitHealthEvent,
  projectAllergy,
  projectCondition,
  projectImmunization,
  projectPrescription,
  projectReport,
} from "@medpass/health-events";
import type { MaterializeMedicationInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { eventCtx } from "../../common/health-events";
import { PrismaService } from "../../common/prisma.service";
import { MedicationsService } from "../medications/medications.service";
import type { DocumentActor } from "./documents-v2.service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ONLY PLACE A CANDIDATE BECOMES CLINICAL DATA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * docs_v2/09 §1 rule 3: "There is exactly one code path that materializes
 * candidates … and a test asserts no other writer exists." That test is
 * `apps/api/src/modules/documents-v2/single-writer.spec.ts`: it greps this
 * module for clinical `.create(` calls and fails if any live outside this
 * file. Everything else in `documents-v2/` is read-only on clinical tables.
 *
 * Every row written here is stamped, without exception:
 *   provenanceSource   = ocr_extracted   (it came off a photo)
 *   verification       = patient_confirmed (a person confirmed this exact value)
 *   sourceDocumentId   = the document the text was on
 *   sourceExtractionId = the extraction run that proposed it
 * and the candidate rows that fed it record `resultingEntityType` /
 * `resultingEntityId`, so every clinical value can be walked back to the
 * pixels it came from (docs_v2/09 §1 rule 2).
 *
 * Dose quantity is never among the extracted values (docs_v2/09 §1 rule 4,
 * hazard H-02): the medication branch refuses to run without a dose the
 * person typed.
 */

/** One confirmed field, with the value that was actually confirmed (a correction wins over the proposal). */
export interface MaterializedField {
  candidateId: string;
  targetField: string;
  value: unknown;
  detectedText: string;
}

export interface MaterializeDeps {
  prisma: PrismaService;
  medications: MedicationsService;
}

/**
 * docs_v2/08 §7: candidates parsed from an ABDM bundle materialize with the bundle's provenance
 * — `abdm_imported`, `source_authenticated` (the HIP authenticated it), `sourceAbdmTxnId` — not
 * as OCR rows. Derived from the *document's* own provenance by the caller; never client-supplied.
 */
export interface ImportProvenance {
  provenanceSource: "abdm_imported";
  verification: "source_authenticated";
  sourceAbdmTxnId: string | null;
}

export interface MaterializeParams {
  profileId: string;
  documentId: string;
  extractionId: string;
  actor: DocumentActor;
  targetEntity: string;
  groupKey: string | null;
  /** Present when the document is an ABDM import (docs_v2/08 §7); absent for a scanned page. */
  importProvenance?: ImportProvenance | null;
  /** Every confirmed field of one group — one medication line, one lab row, one practitioner. */
  fields: MaterializedField[];
  /** Dose and anything else the person typed rather than the page supplied. */
  medication?: MaterializeMedicationInput;
  /** The document's clinical parents, so a group updates an existing record instead of minting a rival. */
  prescriptionId?: string | null;
  diagnosticReportId?: string | null;
  encounterId?: string | null;
  /**
   * Joins the caller's transaction so a batch materialize lands as one unit
   * (docs_v2/05 §5 "transactional"). The medication branch cannot accept one:
   * it goes through `MedicationsService`, which owns its own transaction plus
   * schedule generation and safety re-evaluation.
   */
  tx?: Prisma.TransactionClient;
}

export interface MaterializedRow {
  entityType: string;
  entityId: string;
  candidateIds: string[];
}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * The provenance every materialized row carries (docs_v2/04 §7.5, ADR-V2-002). An ABDM import
 * keeps the bundle's own provenance (docs_v2/08 §7); a scanned page is OCR the person confirmed.
 */
function ocrProvenance(params: MaterializeParams) {
  const stamp = {
    provenanceSource: "ocr_extracted" as "ocr_extracted" | "abdm_imported",
    // A candidate only reaches this function because a person looked at the
    // page crop and said yes — that is exactly `patient_confirmed`, and it is
    // the one thing that lifts an OCR row above `unverified`.
    verification: "patient_confirmed" as "patient_confirmed" | "source_authenticated",
    recordedVia: params.actor.recordedVia ?? "pwa",
    recordedByUserId: params.actor.userId,
    sourceDocumentId: params.documentId,
    sourceExtractionId: params.extractionId,
    sourceAbdmTxnId: null as string | null,
  };
  if (params.importProvenance) {
    stamp.provenanceSource = params.importProvenance.provenanceSource;
    stamp.verification = params.importProvenance.verification;
    stamp.sourceAbdmTxnId = params.importProvenance.sourceAbdmTxnId;
  }
  return stamp;
}

function fieldValue<T>(params: MaterializeParams, field: string): T | undefined {
  return params.fields.find((f) => f.targetField === field)?.value as T | undefined;
}

function candidateIds(params: MaterializeParams): string[] {
  return params.fields.map((f) => f.candidateId);
}

function requireNoTx(params: MaterializeParams, entity: string): void {
  if (params.tx) {
    throw new ApiProblem(
      ERROR_CODES.VALIDATION_FAILED,
      `${entity} candidates are materialized on their own, not inside a batch`,
      400,
    );
  }
}

/**
 * Materializes one confirmed candidate group into one clinical row.
 * Returns null when the group carries nothing this entity can build from.
 */
export async function materializeCandidate(
  deps: MaterializeDeps,
  params: MaterializeParams,
): Promise<MaterializedRow | null> {
  switch (params.targetEntity) {
    case "medication":
      return materializeMedication(deps, params);
    case "prescription":
      return withTx(deps, params, materializePrescription);
    case "practitioner":
      return withTx(deps, params, materializePractitioner);
    case "organization":
      return withTx(deps, params, materializeOrganization);
    case "diagnostic_report":
      return withTx(deps, params, async (tx, p) => {
        const reportId = await ensureDiagnosticReport(tx, p);
        return { entityType: "diagnostic_report", entityId: reportId, candidateIds: candidateIds(p) };
      });
    case "diagnostic_result":
      return withTx(deps, params, materializeDiagnosticResult);
    case "condition":
      return withTx(deps, params, materializeCondition);
    case "allergy":
      return withTx(deps, params, materializeAllergy);
    case "immunization":
      return withTx(deps, params, materializeImmunization);
    case "encounter":
      // docs_v2/09 §5 lists encounter as an extraction target, but an
      // encounter is the *container* a visit's records hang off, not a fact
      // read off a page — creating one from OCR would silently regroup a
      // patient's history (H-36). Candidates are shown and kept; a person
      // creates the encounter and links the document to it.
      return null;
    default:
      throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "This suggestion can't be saved yet", 400);
  }
}

/** Runs the branch in the caller's transaction when there is one, else opens its own. */
async function withTx(
  deps: MaterializeDeps,
  params: MaterializeParams,
  run: (tx: Tx, params: MaterializeParams) => Promise<MaterializedRow | null>,
): Promise<MaterializedRow | null> {
  if (params.tx) return run(params.tx, params);
  return deps.prisma.$transaction(async (tx) => run(tx, params));
}

// ---------------------------------------------------------------------------
// medication
// ---------------------------------------------------------------------------

/**
 * Goes through `MedicationsService.create` so a medicine confirmed off a photo
 * is byte-for-byte one added by hand: same normalization, same schedule
 * generation, same safety re-evaluation, same change history. `source:
 * "extraction"` makes that service stamp `ocr_extracted`; this function then
 * lifts the row to `patient_confirmed` and records which document and
 * extraction it came from.
 */
async function materializeMedication(deps: MaterializeDeps, params: MaterializeParams): Promise<MaterializedRow | null> {
  requireNoTx(params, "Medicine");
  const brand = fieldValue<{ productId: string; label: string }>(params, "brandName");
  const genericName = fieldValue<string>(params, "genericName");
  const anchor = params.fields.find((f) => f.targetField === "brandName" || f.targetField === "genericName");
  const typed = params.medication;
  // Confirming fields one at a time is the normal review flow (docs_v2/09
  // §10): a group with no medicine name yet, or no dose typed yet, is simply
  // not ready — that is a state, not an error. The medicine is created on the
  // call that carries the dose, which is the client's explicit "add this".
  // H-02: OCR digits are never a dose, so `medication` always comes from the
  // person, never from the page.
  if (!anchor || !typed) return null;

  const extracted = fieldValue<{ code: string; pattern?: string }>(params, "frequency");
  const frequencyCode = (typed.frequencyCode ?? extracted?.code) as FrequencyCode | undefined;
  const pattern = typed.pattern ?? extracted?.pattern;
  if (!frequencyCode) {
    throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Confirm how often this medicine is taken", 400, [
      { path: "medication.frequencyCode", message: "The page didn't say how often" },
    ]);
  }
  if (frequencyCode === "PATTERN" && !pattern) {
    throw new ApiProblem(ERROR_CODES.VALIDATION_FAILED, "Pattern (e.g. 1-0-1) is required", 400);
  }

  const strength = fieldValue<{ value: string; unit: string }>(params, "strengthLabel");
  const enteredName = brand?.label ?? genericName ?? anchor.detectedText.slice(0, 200);

  const medication = await deps.medications.create(
    params.profileId,
    {
      productId: brand?.productId,
      enteredName,
      source: "extraction",
      prescriptionId: params.prescriptionId ?? undefined,
      isPrn: typed.isPrn,
      criticalEscalation: false,
      startDate: typed.startDate,
      patientReason: typed.patientReason,
      instruction: {
        doseQuantity: typed.doseQuantity,
        doseUnit: typed.doseUnit,
        frequencyCode,
        pattern,
        foodInstruction:
          typed.foodInstruction ?? (fieldValue<FoodInstruction>(params, "foodInstruction") as FoodInstruction) ?? "any",
        durationDays: fieldValue<number>(params, "durationDays"),
        originalText: fieldValue<string>(params, "instructionsText") ?? anchor.detectedText.slice(0, 500),
        routeText: fieldValue<string>(params, "route") ?? null,
        strengthLabel: strength ? `${strength.value} ${strength.unit}` : null,
      },
    } as never,
    params.actor,
  );

  // MedicationsService stamped the row as an OCR extraction; restamp it with the document's own
  // provenance (verification, document/extraction links, and the ABDM transaction for an import).
  const { recordedVia: _via, recordedByUserId: _by, ...restamp } = ocrProvenance(params);
  await deps.prisma.patientMedication.update({ where: { id: medication.id }, data: restamp });
  await deps.prisma.medicationInstruction.updateMany({ where: { patientMedicationId: medication.id }, data: restamp });

  await auditMaterialization(deps.prisma, params, "patient_medication", medication.id);
  return { entityType: "patient_medication", entityId: medication.id, candidateIds: candidateIds(params) };
}

// ---------------------------------------------------------------------------
// prescription
// ---------------------------------------------------------------------------

async function materializePrescription(tx: Tx, params: MaterializeParams): Promise<MaterializedRow> {
  const prescriptionId = await ensurePrescription(tx, params);
  const prescribedAt = fieldValue<string>(params, "prescribedAt");
  const diagnosisText = fieldValue<string>(params, "diagnosisText");
  const validUntil = fieldValue<string>(params, "validUntil");
  const followUpOn = fieldValue<string>(params, "followUpOn");

  const updated = await tx.prescription.update({
    where: { id: prescriptionId },
    data: {
      ...(prescribedAt ? { prescribedAt: new Date(prescribedAt) } : {}),
      ...(diagnosisText ? { diagnosisText } : {}),
      ...(validUntil ? { validUntil: new Date(validUntil) } : {}),
      ...(followUpOn ? { followUpOn: new Date(followUpOn) } : {}),
      ...ocrProvenance(params),
    },
    include: { practitioner: { select: { displayName: true } } },
  });
  await emitHealthEvent(
    tx,
    projectPrescription(await eventCtx(tx, params.profileId, params.actor), {
      ...updated,
      practitionerName: updated.practitioner?.displayName ?? null,
    }),
  );
  await auditMaterialization(tx, params, "prescription", prescriptionId);
  return { entityType: "prescription", entityId: prescriptionId, candidateIds: candidateIds(params) };
}

/** The document's prescription, or a new one linked to it — never a second rival record for the same page. */
async function ensurePrescription(tx: Tx, params: MaterializeParams): Promise<string> {
  if (params.prescriptionId) return params.prescriptionId;
  const created = await tx.prescription.create({
    data: {
      patientProfileId: params.profileId,
      encounterId: params.encounterId ?? null,
      ...ocrProvenance(params),
    },
  });
  await tx.patientDocument.update({ where: { id: params.documentId }, data: { prescriptionId: created.id } });
  return created.id;
}

// ---------------------------------------------------------------------------
// practitioner / organization
// ---------------------------------------------------------------------------

/**
 * Matched by display name within the patient's own directory before creating —
 * a repeat visit to the same doctor must not mint a second Practitioner row.
 */
async function materializePractitioner(tx: Tx, params: MaterializeParams): Promise<MaterializedRow | null> {
  const displayName = fieldValue<string>(params, "displayName");
  const speciality = fieldValue<string>(params, "speciality");
  const registrationNumber = fieldValue<string>(params, "registrationNumber");
  if (!displayName) return null;

  const existing = await tx.practitioner.findFirst({
    where: { createdByProfileId: params.profileId, displayName, deletedAt: null },
    select: { id: true },
  });
  const id = existing
    ? (
        await tx.practitioner.update({
          where: { id: existing.id },
          data: {
            ...(speciality ? { speciality } : {}),
            ...(registrationNumber ? { registrationNumber } : {}),
            verification: ocrProvenance(params).verification,
          },
          select: { id: true },
        })
      ).id
    : (
        await tx.practitioner.create({
          data: {
            createdByProfileId: params.profileId,
            displayName,
            speciality: speciality ?? null,
            registrationNumber: registrationNumber ?? null,
            verification: ocrProvenance(params).verification,
          },
          select: { id: true },
        })
      ).id;

  // A prescription on the same page gets its doctor filled in, which is the
  // whole point of reading the letterhead.
  if (params.prescriptionId) {
    await tx.prescription.update({ where: { id: params.prescriptionId }, data: { practitionerId: id } });
  }
  await auditMaterialization(tx, params, "practitioner", id);
  return { entityType: "practitioner", entityId: id, candidateIds: candidateIds(params) };
}

async function materializeOrganization(tx: Tx, params: MaterializeParams): Promise<MaterializedRow | null> {
  const displayName = fieldValue<string>(params, "displayName");
  const city = fieldValue<string>(params, "city");
  if (!displayName) return null;

  const existing = await tx.organization.findFirst({
    where: { patientProfileId: params.profileId, displayName, deletedAt: null },
    select: { id: true },
  });
  const id = existing
    ? (
        await tx.organization.update({
          where: { id: existing.id },
          data: { ...(city ? { city } : {}), verification: ocrProvenance(params).verification },
          select: { id: true },
        })
      ).id
    : (
        await tx.organization.create({
          data: {
            patientProfileId: params.profileId,
            displayName,
            city: city ?? null,
            verification: ocrProvenance(params).verification,
            recordedByUserId: params.actor.userId,
          },
          select: { id: true },
        })
      ).id;
  await auditMaterialization(tx, params, "organization", id);
  return { entityType: "organization", entityId: id, candidateIds: candidateIds(params) };
}

// ---------------------------------------------------------------------------
// diagnostics
// ---------------------------------------------------------------------------

/** The document's report, or a new one linked to it (H-36: one document, one report). */
async function ensureDiagnosticReport(tx: Tx, params: MaterializeParams): Promise<string> {
  if (params.diagnosticReportId) return params.diagnosticReportId;
  const document = await tx.patientDocument.findUniqueOrThrow({
    where: { id: params.documentId },
    select: { title: true, kind: true, documentDate: true, encounterId: true },
  });
  const title = fieldValue<string>(params, "title") ?? document.title ?? "Test report";
  const testedAt = fieldValue<string>(params, "testedAt");
  const reportedAt = fieldValue<string>(params, "reportedAt");
  const specimenCollectedAt = fieldValue<string>(params, "specimenCollectedAt");
  const labName = fieldValue<string>(params, "labName");

  const created = await tx.diagnosticReport.create({
    data: {
      patientProfileId: params.profileId,
      encounterId: params.encounterId ?? document.encounterId,
      kind: document.kind === "imaging_report" || document.kind === "scan_report" ? "imaging" : "laboratory",
      title,
      testedAt: testedAt ? new Date(testedAt) : document.documentDate,
      reportedAt: reportedAt ? new Date(reportedAt) : null,
      specimenCollectedAt: specimenCollectedAt ? new Date(specimenCollectedAt) : null,
      facilityNameText: labName ?? null,
      ...ocrProvenance(params),
    },
  });
  await tx.patientDocument.update({ where: { id: params.documentId }, data: { diagnosticReportId: created.id } });
  await emitHealthEvent(tx, {
    ...projectReport(await eventCtx(tx, params.profileId, params.actor), {
      ...created,
      kind: created.kind,
      label: created.title,
      facilityName: created.facilityNameText,
    }),
    entityType: "diagnostic_report",
  });
  await auditMaterialization(tx, params, "diagnostic_report", created.id);
  return created.id;
}

/**
 * One printed row of a lab report. The value and the unit are stored exactly
 * as printed and never converted — a silent mg/dL → mmol/L conversion is
 * hazard H-35. `interpretation` is never written here at all: it is in
 * NEVER_AUTO_PROPOSED, so no candidate for it can exist.
 */
async function materializeDiagnosticResult(tx: Tx, params: MaterializeParams): Promise<MaterializedRow | null> {
  const enteredValueText = fieldValue<string>(params, "enteredValueText");
  const analyteLabelText = fieldValue<string>(params, "analyteLabelText");
  if (!enteredValueText || !analyteLabelText) return null;

  const reportId = await ensureDiagnosticReport(tx, params);
  const analyteKey = fieldValue<string>(params, "analyteKey") ?? analyteKeyFor(analyteLabelText);
  const numeric = Number(enteredValueText);
  const last = await tx.diagnosticResult.findFirst({
    where: { diagnosticReportId: reportId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });

  const created = await tx.diagnosticResult.create({
    data: {
      diagnosticReportId: reportId,
      patientProfileId: params.profileId,
      analyteKey,
      analyteLabelText,
      enteredValueText,
      // Numeric only when the printed text really is a number; "Negative"
      // stays text, never coerced to 0.
      valueNumeric: Number.isFinite(numeric) && enteredValueText.trim() !== "" ? numeric : null,
      valueText: Number.isFinite(numeric) && enteredValueText.trim() !== "" ? null : enteredValueText,
      enteredUnit: fieldValue<string>(params, "enteredUnit") ?? null,
      referenceText: fieldValue<string>(params, "referenceText") ?? null,
      comparator: fieldValue<string>(params, "comparator") ?? null,
      sequence: (last?.sequence ?? 0) + 1,
      ...ocrProvenance(params),
    },
  });
  await auditMaterialization(tx, params, "diagnostic_result", created.id);
  return { entityType: "diagnostic_result", entityId: created.id, candidateIds: candidateIds(params) };
}

/** Slug of the printed label — a placeholder key, never a claim that this analyte was recognised. */
export function analyteKeyFor(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug.length > 0 ? slug : "unknown";
}

// ---------------------------------------------------------------------------
// condition / allergy / immunization
// ---------------------------------------------------------------------------

async function materializeCondition(tx: Tx, params: MaterializeParams): Promise<MaterializedRow | null> {
  const label = fieldValue<string>(params, "label");
  if (!label) return null;
  const created = await tx.patientCondition.create({
    data: {
      patientProfileId: params.profileId,
      label,
      source: "document",
      clinicalStatus: "active",
      encounterId: params.encounterId ?? null,
      ...ocrProvenance(params),
    },
  });
  await emitHealthEvent(tx, projectCondition(await eventCtx(tx, params.profileId, params.actor), created));
  await auditMaterialization(tx, params, "patient_condition", created.id);
  return { entityType: "patient_condition", entityId: created.id, candidateIds: candidateIds(params) };
}

/**
 * Severity is deliberately `unknown`: a printed allergy line almost never
 * states one, and inventing "mild" would understate a real risk.
 */
async function materializeAllergy(tx: Tx, params: MaterializeParams): Promise<MaterializedRow | null> {
  const label = fieldValue<string>(params, "label");
  if (!label) return null;
  const created = await tx.patientAllergy.create({
    data: {
      patientProfileId: params.profileId,
      label,
      severity: "unknown",
      source: "document",
      ...ocrProvenance(params),
    },
  });
  await emitHealthEvent(tx, projectAllergy(await eventCtx(tx, params.profileId, params.actor), created));
  await auditMaterialization(tx, params, "patient_allergy", created.id);
  return { entityType: "patient_allergy", entityId: created.id, candidateIds: candidateIds(params) };
}

async function materializeImmunization(tx: Tx, params: MaterializeParams): Promise<MaterializedRow | null> {
  const vaccineText = fieldValue<string>(params, "vaccineText");
  const administeredOn = fieldValue<string>(params, "administeredOn");
  if (!vaccineText || !administeredOn) return null;
  const created = await tx.immunization.create({
    data: {
      patientProfileId: params.profileId,
      vaccineText,
      administeredOn: new Date(administeredOn),
      doseNumber: fieldValue<number>(params, "doseNumber") ?? null,
      documentId: params.documentId,
      ...ocrProvenance(params),
    },
  });
  await emitHealthEvent(tx, projectImmunization(await eventCtx(tx, params.profileId, params.actor), created));
  await auditMaterialization(tx, params, "immunization", created.id);
  return { entityType: "immunization", entityId: created.id, candidateIds: candidateIds(params) };
}

// ---------------------------------------------------------------------------

/** PHI-free: the target and the row it became, never the confirmed value itself. */
async function auditMaterialization(
  tx: Tx,
  params: MaterializeParams,
  entityType: string,
  entityId: string,
): Promise<void> {
  await writeAudit(tx, {
    action: "extraction.materialized",
    actorUserId: params.actor.userId,
    actorType: params.actor.actorRole,
    entityType,
    entityId,
    patientProfileId: params.profileId,
    correlationId: params.actor.correlationId,
    context: {
      targetEntity: params.targetEntity,
      fields: params.fields.map((f) => f.targetField),
      documentId: params.documentId,
      extractionId: params.extractionId,
    },
  });
}
