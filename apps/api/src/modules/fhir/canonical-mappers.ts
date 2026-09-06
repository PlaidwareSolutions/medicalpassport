import type {
  DiagnosticReport,
  DiagnosticResult,
  DocumentPage,
  MedicationIngredient,
  MedicationInstruction,
  MedicationProduct,
  MedicationProductIngredient,
  Observation,
  Organization,
  PatientAllergy,
  PatientCondition,
  PatientDocument,
  PatientMedication,
  PatientProfile,
  Practitioner,
  Prescription,
  PrescriptionItem,
  StoredObject,
} from "@medpass/database";
import type {
  CanonicalAllergy,
  CanonicalCondition,
  CanonicalDiagnosticReport,
  CanonicalDocumentReference,
  CanonicalDosage,
  CanonicalLabObservation,
  CanonicalMedication,
  CanonicalMedicationRequest,
  CanonicalMedicationStatement,
  CanonicalOrganization,
  CanonicalPatient,
  CanonicalPatientRef,
  CanonicalPractitioner,
  CanonicalPrescription,
  CanonicalProvenance,
  CanonicalVitalObservation,
  FrequencyCode,
  ObservationConcept,
} from "@medpass/fhir";
import { isRecordSource, isRecordedVia, normalizeRecordSource, type RecordSource } from "@medpass/provenance";

/**
 * Prisma rows → canonical DTOs (ADR-V2-001: FHIR only at the boundary; the DTOs are plain
 * objects the pure `@medpass/fhir` package understands). Nothing here touches the database.
 *
 * Provenance is read off the row's own columns (docs_v2/04 §1.2). A row whose `verification` is
 * still null (a V1 row the Phase 1 backfill has not reached) gets `provenance: null`, which the
 * serializer refuses — the export records that refusal as a `FhirValidationFailure` and moves on.
 */

/** The provenance columns every clinical table carries (docs_v2/04 §1.2). */
export interface ProvenanceColumns {
  provenanceSource: string | null;
  verification: string | null;
  recordedVia: string | null;
  recordedByUserId: string | null;
  sourceDocumentId: string | null;
  sourceExtractionId: string | null;
  sourceDeviceId: string | null;
  sourceAbdmTxnId: string | null;
  sourceOrganizationId: string | null;
  sourcePractitionerId: string | null;
  verifiedByUserId: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

export function provenanceOf(row: ProvenanceColumns, legacySource?: string | null): CanonicalProvenance | null {
  const rawSource = row.provenanceSource ?? legacySource ?? null;
  const source: RecordSource | null = rawSource === null ? null : isRecordSource(rawSource) ? rawSource : normalizeRecordSource(rawSource as never);
  const verification = row.verification;
  if (!source || !verification) return null;
  return {
    source,
    verification: verification as CanonicalProvenance["verification"],
    recordedByUserId: row.recordedByUserId,
    recordedVia: isRecordedVia(row.recordedVia) ? row.recordedVia : "pwa",
    recordedAt: row.createdAt.toISOString(),
    sourceDocumentId: row.sourceDocumentId,
    sourceExtractionId: row.sourceExtractionId,
    sourceDeviceId: row.sourceDeviceId,
    sourceAbdmTxnId: row.sourceAbdmTxnId,
    sourceOrganizationId: row.sourceOrganizationId,
    sourcePractitionerId: row.sourcePractitionerId,
    verifiedByUserId: row.verifiedByUserId,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  };
}

/** `@db.Date` columns come back as UTC midnight; export the calendar date only. */
export function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function instant(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function decimal(value: { toString(): string } | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

export interface AbhaIdentity {
  abhaAddress: string | null;
  abhaNumber: string | null;
}

export function patientRefOf(profile: Pick<PatientProfile, "id" | "displayName">, abha: AbhaIdentity): CanonicalPatientRef {
  return { patientProfileId: profile.id, abhaAddress: abha.abhaAddress, display: profile.displayName };
}

/**
 * The profile row has no provenance block of its own: it is the patient's identity, recorded by
 * its owner when the profile was created. A linked ABHA makes it source-authenticated identity.
 */
export function toCanonicalPatient(profile: PatientProfile, abha: AbhaIdentity, verifiedAt: Date | null): CanonicalPatient {
  return {
    id: profile.id,
    displayName: profile.displayName,
    yearOfBirth: profile.yearOfBirth,
    // FHIR administrative-gender has no "undisclosed": that is `unknown` (the value is withheld, not absent).
    sex: profile.sex === "undisclosed" ? "unknown" : profile.sex,
    abhaAddress: abha.abhaAddress,
    abhaNumber: abha.abhaNumber,
    provenance: {
      source: "user_entered",
      verification: abha.abhaAddress ? "source_authenticated" : "patient_confirmed",
      recordedByUserId: profile.ownerUserId,
      recordedVia: "pwa",
      recordedAt: profile.createdAt.toISOString(),
      verifiedAt: verifiedAt?.toISOString() ?? null,
    },
  };
}

export function toCanonicalPractitioner(row: Practitioner): CanonicalPractitioner {
  return {
    id: row.id,
    displayName: row.displayName,
    speciality: row.speciality,
    registrationNumber: row.registrationNumber,
    registrationCouncil: row.registrationCouncil,
    hprId: row.hprId,
    organizationId: row.organizationId,
    // Directory rows carry `verification` + `recordedByUserId`; the source follows the verification.
    provenance: {
      source: row.hprId ? "abdm_imported" : row.verification === "provider_verified" ? "clinic_entered" : "user_entered",
      verification: row.verification,
      recordedByUserId: null,
      recordedVia: row.verification === "provider_verified" ? "clinic_portal" : "pwa",
      recordedAt: row.createdAt.toISOString(),
    },
  };
}

export function toCanonicalOrganization(row: Organization): CanonicalOrganization {
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    hfrId: row.hfrId,
    addressText: row.addressText,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    provenance: {
      source: row.hfrId ? "abdm_imported" : row.verification === "provider_verified" ? "clinic_entered" : "user_entered",
      verification: row.verification,
      recordedByUserId: row.recordedByUserId,
      recordedVia: row.verification === "provider_verified" ? "clinic_portal" : "pwa",
      recordedAt: row.createdAt.toISOString(),
    },
  };
}

export function toCanonicalAllergy(row: PatientAllergy, patient: CanonicalPatientRef): CanonicalAllergy {
  return {
    id: row.id,
    patient,
    substanceText: row.label,
    category: row.category ?? "other",
    clinicalStatus: row.active ? "active" : "inactive",
    criticality: row.criticality,
    severity: row.severity === "unknown" ? null : row.severity,
    reactionText: row.reactionNote,
    onsetDate: dateOnly(row.onsetDate),
    codeSystem: row.codeSystem,
    code: row.code,
    notes: null,
    provenance: provenanceOf(row, row.source),
  };
}

export function toCanonicalCondition(row: PatientCondition, patient: CanonicalPatientRef): CanonicalCondition {
  return {
    id: row.id,
    patient,
    label: row.label,
    clinicalStatus: row.clinicalStatus ?? (row.active ? "active" : "inactive"),
    onsetDate: dateOnly(row.onsetDate),
    abatementDate: dateOnly(row.abatementDate),
    codeSystem: row.codeSystem,
    code: row.code,
    severity: row.severity,
    note: row.note,
    diagnosedByPractitionerId: row.diagnosedByPractitionerId,
    encounterId: row.encounterId,
    provenance: provenanceOf(row, row.source),
  };
}

export type ProductWithIngredients = MedicationProduct & { ingredients: Array<MedicationProductIngredient & { ingredient: MedicationIngredient }>; dosageForm?: { name: string } | null };

/** Catalog reference data has no provenance of its own: it borrows the referencing row's block. */
export function toCanonicalMedication(product: ProductWithIngredients, borrowed: CanonicalProvenance | null): CanonicalMedication {
  return {
    id: product.id,
    displayText: product.genericName,
    codeSystem: null,
    code: null,
    formText: product.dosageForm?.name ?? null,
    strengthLabel: product.strengthLabel,
    ingredients: product.ingredients.map((i) => ({ text: i.ingredient.name, strengthValue: decimal(i.strengthValue), strengthUnit: i.strengthUnit })),
    provenance: borrowed,
  };
}

function frequencyCodeOf(value: string | null): FrequencyCode | null {
  const codes: readonly string[] = ["OD", "OD_AFTERNOON", "BD", "TDS", "QID", "SOS", "HS", "PATTERN", "ALTERNATE_DAY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "CUSTOM"];
  return value && codes.includes(value) ? (value as FrequencyCode) : null;
}

function foodOf(value: string | null): CanonicalDosage["foodInstruction"] {
  const foods: readonly string[] = ["before", "with", "after", "any", "bedtime"];
  return value && foods.includes(value) ? (value as CanonicalDosage["foodInstruction"]) : null;
}

export function toCanonicalPrescription(row: Prescription, patient: CanonicalPatientRef): CanonicalPrescription {
  return {
    id: row.id,
    patient,
    prescribedAt: dateOnly(row.prescribedAt),
    notes: row.notes,
    diagnosisText: row.diagnosisText,
    validUntil: dateOnly(row.validUntil),
    followUpOn: dateOnly(row.followUpOn),
    practitionerId: row.practitionerId,
    encounterId: row.encounterId,
    provenance: provenanceOf(row),
  };
}

export function toCanonicalMedicationRequest(item: PrescriptionItem, prescription: Prescription, patient: CanonicalPatientRef, now: Date): CanonicalMedicationRequest {
  return {
    id: item.id,
    patient,
    prescriptionId: item.prescriptionId,
    sequence: item.sequence,
    enteredName: item.enteredName,
    medicationId: item.productId,
    strengthLabel: item.strengthLabel,
    formText: item.formText,
    authoredOn: dateOnly(prescription.prescribedAt),
    practitionerId: prescription.practitionerId,
    encounterId: prescription.encounterId,
    completed: prescription.validUntil !== null && prescription.validUntil.getTime() < now.getTime(),
    dosage: {
      doseQuantity: decimal(item.doseQuantity),
      doseUnit: item.doseUnit,
      frequencyCode: frequencyCodeOf(item.frequencyCode),
      pattern: item.pattern,
      foodInstruction: foodOf(item.foodInstruction),
      durationDays: item.durationDays,
      routeText: item.routeText,
      text: item.instructionsText,
    },
    provenance: provenanceOf(item),
  };
}

export function toCanonicalMedicationStatement(row: PatientMedication, instruction: MedicationInstruction | null, patient: CanonicalPatientRef): CanonicalMedicationStatement {
  return {
    id: row.id,
    patient,
    enteredName: row.enteredName,
    medicationId: row.productId,
    status: row.status,
    startDate: dateOnly(row.startDate),
    endDate: dateOnly(row.endDate),
    patientReason: row.patientReason,
    reasonConditionId: row.reasonConditionId,
    prescriptionId: row.prescriptionId,
    isPrn: row.isPrn,
    dosage: instruction
      ? {
          doseQuantity: decimal(instruction.doseQuantity),
          doseUnit: instruction.doseUnit,
          frequencyCode: instruction.frequencyCode,
          pattern: instruction.pattern,
          foodInstruction: instruction.foodInstruction,
          durationDays: instruction.durationDays,
          routeText: instruction.routeText,
          text: instruction.originalText,
        }
      : null,
    provenance: provenanceOf(row),
  };
}

export function toCanonicalDiagnosticReport(row: DiagnosticReport, resultIds: string[], documentIds: string[], patient: CanonicalPatientRef): CanonicalDiagnosticReport {
  return {
    id: row.id,
    patient,
    kind: row.kind,
    title: row.title,
    category: row.category,
    status: row.status,
    specimenCollectedAt: instant(row.specimenCollectedAt),
    reportedAt: instant(row.reportedAt),
    testedAt: dateOnly(row.testedAt),
    organizationId: row.organizationId,
    facilityNameText: row.facilityNameText,
    orderingPractitionerId: row.orderingPractitionerId,
    reportingPractitionerId: row.reportingPractitionerId,
    modality: row.modality,
    bodySite: row.bodySite,
    impressionText: row.impressionText,
    findingsText: row.findingsText,
    conclusionText: row.conclusionText,
    encounterId: row.encounterId,
    resultIds,
    documentIds,
    provenance: provenanceOf(row),
  };
}

export function toCanonicalLabObservation(row: DiagnosticResult, report: DiagnosticReport, patient: CanonicalPatientRef): CanonicalLabObservation {
  const comparators: readonly string[] = ["<", "<=", ">", ">="];
  return {
    id: row.id,
    patient,
    diagnosticReportId: row.diagnosticReportId,
    analyteKey: row.analyteKey,
    analyteLabelText: row.analyteLabelText,
    loincCode: row.loincCode,
    enteredValueText: row.enteredValueText,
    valueNumeric: decimal(row.valueNumeric),
    valueText: row.valueText,
    comparator: row.comparator && comparators.includes(row.comparator) ? (row.comparator as CanonicalLabObservation["comparator"]) : null,
    unit: row.unit,
    enteredUnit: row.enteredUnit,
    referenceLow: decimal(row.referenceLow),
    referenceHigh: decimal(row.referenceHigh),
    referenceText: row.referenceText,
    interpretation: row.interpretation,
    specimenType: row.specimenType,
    effectiveAt: instant(report.specimenCollectedAt) ?? dateOnly(report.testedAt),
    provenance: provenanceOf(row),
  };
}

export function toCanonicalVitalObservation(row: Observation, patient: CanonicalPatientRef): CanonicalVitalObservation {
  return {
    id: row.id,
    patient,
    concept: row.concept as ObservationConcept,
    conceptText: row.concept === "other" ? (row.conceptCode ?? row.notes) : null,
    valueNumeric: decimal(row.valueNumeric),
    valueNumeric2: decimal(row.valueNumeric2),
    valueText: row.valueText,
    unit: row.unit,
    enteredUnit: row.enteredUnit,
    enteredValueText: row.enteredValueText,
    measuredAt: row.measuredAt.toISOString(),
    context: row.context,
    bodySite: row.bodySite,
    method: row.method,
    interpretation: row.interpretation,
    notes: row.notes,
    deviceId: row.deviceId,
    encounterId: row.encounterId,
    provenance: provenanceOf(row),
  };
}

export type DocumentWithPages = PatientDocument & { pages: Array<DocumentPage & { storedObject: Pick<StoredObject, "id" | "contentType" | "sizeBytes" | "sha256"> }> };

export function toCanonicalDocumentReference(row: DocumentWithPages, patient: CanonicalPatientRef): CanonicalDocumentReference {
  const statuses: readonly string[] = ["uploaded", "verified", "processing", "processed", "failed", "deleted"];
  return {
    id: row.id,
    patient,
    kind: row.kind,
    title: row.title,
    documentDate: dateOnly(row.documentDate),
    status: statuses.includes(row.status) ? (row.status as CanonicalDocumentReference["status"]) : "uploaded",
    pages: row.pages.map((page) => ({
      pageNumber: page.pageNumber,
      contentType: page.storedObject.contentType ?? "application/octet-stream",
      storedObjectId: page.storedObject.id,
      sizeBytes: page.storedObject.sizeBytes === null || page.storedObject.sizeBytes === undefined ? null : Number(page.storedObject.sizeBytes),
      sha256Hex: page.storedObject.sha256 ?? null,
    })),
    prescriptionId: row.prescriptionId,
    diagnosticReportId: row.diagnosticReportId,
    encounterId: row.encounterId,
    provenance: provenanceOf(row),
  };
}
