import type { CanonicalPatientRef } from "./patient-ref.js";
import type { CanonicalProvenance } from "./provenance.js";

/** V1/V2 `FrequencyCode` (packages/domain). */
export const FREQUENCY_CODES = [
  "OD",
  "OD_AFTERNOON",
  "BD",
  "TDS",
  "QID",
  "SOS",
  "HS",
  "PATTERN",
  "ALTERNATE_DAY",
  "WEEKLY",
  "FORTNIGHTLY",
  "MONTHLY",
  "CUSTOM",
] as const;
export type FrequencyCode = (typeof FREQUENCY_CODES)[number];

export const FOOD_INSTRUCTIONS = ["before", "with", "after", "any", "bedtime"] as const;
export type FoodInstruction = (typeof FOOD_INSTRUCTIONS)[number];

/** docs_v2/04 §4.1 `MedicationStatus` (PatientMedication). */
export const MEDICATION_STATUSES = ["current", "paused", "completed", "stopped", "unknown"] as const;
export type MedicationStatus = (typeof MEDICATION_STATUSES)[number];

export interface CanonicalMedicationIngredient {
  text: string;
  /** Decimal as a string so no precision is lost in transit (Prisma Decimal). */
  strengthValue: string | null;
  strengthUnit: string | null;
}

/**
 * docs_v2/08 §6 #2: a catalog `MedicationProduct` (or, when a row was never normalized, the entered
 * name alone). `code` is RxNorm when mapped, otherwise the local CodeSystem. Provenance comes from
 * the row that references the product (there is no provenance on catalog reference data).
 */
export interface CanonicalMedication {
  id: string;
  displayText: string;
  codeSystem: string | null;
  code: string | null;
  codeDisplay?: string | null;
  formText: string | null;
  strengthLabel: string | null;
  ingredients: CanonicalMedicationIngredient[];
  provenance: CanonicalProvenance | null;
}

/**
 * One dosage line — the shape shared by `PrescriptionItem` and the current `MedicationInstruction`
 * (docs_v2/04 §4.1). `originalText` is preserved verbatim into `Dosage.text` (docs_v2/08 §6 #3).
 */
export interface CanonicalDosage {
  /** Decimal as a string; `null` when the item never carried a dose (a prescription line without one). */
  doseQuantity: string | null;
  doseUnit: string | null;
  frequencyCode: FrequencyCode | null;
  /** "1-0-1" style morning-noon-night pattern when `frequencyCode` is PATTERN. */
  pattern: string | null;
  foodInstruction: FoodInstruction | null;
  durationDays: number | null;
  routeText: string | null;
  /** Free instructions / original captured text; always preserved. */
  text: string | null;
}

/** docs_v2/08 §6 #3: `PrescriptionItem` (+ its instruction) → `MedicationRequest`. */
export interface CanonicalMedicationRequest {
  id: string;
  patient: CanonicalPatientRef;
  prescriptionId: string;
  sequence: number;
  enteredName: string;
  /** Set when the line is normalized to a catalog product; the bundle then carries that `Medication`. */
  medicationId: string | null;
  strengthLabel: string | null;
  formText: string | null;
  /** `YYYY-MM-DD` visit date (Prescription.prescribedAt) → `authoredOn`. */
  authoredOn: string | null;
  practitionerId: string | null;
  encounterId: string | null;
  /** True when the prescription's `validUntil` is in the past relative to export time (API decides). */
  completed: boolean;
  dosage: CanonicalDosage;
  provenance: CanonicalProvenance | null;
}

/** docs_v2/08 §6 #4: `PatientMedication` → `MedicationStatement` (patient-reported). */
export interface CanonicalMedicationStatement {
  id: string;
  patient: CanonicalPatientRef;
  enteredName: string;
  medicationId: string | null;
  status: MedicationStatus;
  /** `YYYY-MM-DD`. */
  startDate: string | null;
  endDate: string | null;
  patientReason: string | null;
  reasonConditionId: string | null;
  prescriptionId: string | null;
  isPrn: boolean;
  /** Current (non-superseded) instruction, when there is one. */
  dosage: CanonicalDosage | null;
  provenance: CanonicalProvenance | null;
}
