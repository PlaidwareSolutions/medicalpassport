import type { CanonicalPatientRef } from "./patient-ref.js";
import type { CanonicalProvenance } from "./provenance.js";

/** docs_v2/04 §10 `ConditionClinicalStatus`. */
export const CONDITION_CLINICAL_STATUSES = ["active", "remission", "resolved", "inactive", "unknown"] as const;
export type ConditionClinicalStatus = (typeof CONDITION_CLINICAL_STATUSES)[number];

/**
 * docs_v2/08 §6 #13: `PatientCondition` → `Condition`. SNOMED CT is the ABDM-required system; a row
 * without a SNOMED code is exported with the local CodeSystem plus text and reported as a warning.
 */
export interface CanonicalCondition {
  id: string;
  patient: CanonicalPatientRef;
  /** Immutable entered text (V1 `label`). */
  label: string;
  clinicalStatus: ConditionClinicalStatus;
  /** `YYYY-MM-DD` or a FHIR partial date. */
  onsetDate: string | null;
  abatementDate: string | null;
  codeSystem: string | null;
  code: string | null;
  codeDisplay?: string | null;
  severity: string | null;
  note: string | null;
  diagnosedByPractitionerId: string | null;
  encounterId: string | null;
  provenance: CanonicalProvenance | null;
}

export type CanonicalConditionCandidate = Omit<CanonicalCondition, "provenance">;
