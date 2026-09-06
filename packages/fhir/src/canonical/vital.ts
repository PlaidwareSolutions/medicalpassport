import type { ObservationInterpretation } from "./diagnostics.js";
import type { CanonicalPatientRef } from "./patient-ref.js";
import type { CanonicalProvenance } from "./provenance.js";

/** docs_v2/04 §5.2 `ObservationConcept` (ADR-V2-011). */
export const OBSERVATION_CONCEPTS = [
  "blood_pressure",
  "heart_rate",
  "blood_glucose",
  "body_weight",
  "body_height",
  "bmi",
  "spo2",
  "body_temperature",
  "respiratory_rate",
  "inr",
  "peak_flow",
  "pain_score",
  "insulin_dose",
  "fluid_intake",
  "fluid_output",
  "waist_circumference",
  "steps",
  "sleep_hours",
  "other",
] as const;
export type ObservationConcept = (typeof OBSERVATION_CONCEPTS)[number];

/** Concepts that satisfy the R4 vital-signs profile (magic LOINC codes); the rest export as wellness observations (docs_v2/08 §6 #8). */
export const VITAL_SIGN_CONCEPTS: ReadonlySet<ObservationConcept> = new Set<ObservationConcept>([
  "blood_pressure",
  "heart_rate",
  "body_weight",
  "body_height",
  "bmi",
  "spo2",
  "body_temperature",
  "respiratory_rate",
]);

/**
 * docs_v2/08 §6 #8–#12: one generic `Observation` row. `blood_pressure` stores systolic in
 * `valueNumeric` and diastolic in `valueNumeric2` (terminology `components`).
 */
export interface CanonicalVitalObservation {
  id: string;
  patient: CanonicalPatientRef;
  concept: ObservationConcept;
  /** Free label for `other`. */
  conceptText: string | null;
  valueNumeric: string | null;
  valueNumeric2: string | null;
  valueText: string | null;
  /** UCUM code as stored (the terminology canonical unit). */
  unit: string;
  enteredUnit: string | null;
  enteredValueText: string | null;
  /** ISO instant. */
  measuredAt: string;
  context: string | null;
  bodySite: string | null;
  method: string | null;
  interpretation: ObservationInterpretation | null;
  notes: string | null;
  deviceId: string | null;
  encounterId: string | null;
  provenance: CanonicalProvenance | null;
}
