import type { CanonicalPatientRef } from "./patient-ref.js";
import type { CanonicalProvenance } from "./provenance.js";

/** docs_v2/04 §10 `PatientAllergy.category`. */
export const ALLERGY_CATEGORIES = ["medication", "food", "environment", "biologic", "other"] as const;
export type AllergyCategory = (typeof ALLERGY_CATEGORIES)[number];

/** docs_v2/04 §10 `PatientAllergy.criticality`. */
export const ALLERGY_CRITICALITIES = ["low", "high", "unable_to_assess"] as const;
export type AllergyCriticality = (typeof ALLERGY_CRITICALITIES)[number];

/** V1 `AllergySeverity` minus `unknown` (the DTO boundary maps `unknown` to `null`). */
export const ALLERGY_SEVERITIES = ["mild", "moderate", "severe"] as const;
export type AllergySeverity = (typeof ALLERGY_SEVERITIES)[number];

export const ALLERGY_CLINICAL_STATUSES = ["active", "inactive", "resolved"] as const;
export type AllergyClinicalStatus = (typeof ALLERGY_CLINICAL_STATUSES)[number];

/**
 * Canonical allergy DTO (docs_v2/04 §10 `PatientAllergy`).
 * Plain object built by the service from the row — not a Prisma type.
 */
export interface CanonicalAllergy {
  id: string;
  patient: CanonicalPatientRef;
  /** Immutable entered text (V1 `label`). */
  substanceText: string;
  category: AllergyCategory;
  clinicalStatus: AllergyClinicalStatus;
  criticality: AllergyCriticality | null;
  severity: AllergySeverity | null;
  reactionText: string | null;
  /** `YYYY-MM-DD` (or a FHIR partial date `YYYY` / `YYYY-MM`). */
  onsetDate: string | null;
  /** Code system canonical URI (e.g. `http://snomed.info/sct`), resolved by the terminology layer. */
  codeSystem: string | null;
  code: string | null;
  codeDisplay?: string | null;
  notes: string | null;
  /** Mandatory for export; `null` makes the serializer throw `ProvenanceMissingError`. */
  provenance: CanonicalProvenance | null;
}

/** What a parser can recover from a resource — never provenance, which the importing service stamps. */
export type CanonicalAllergyCandidate = Omit<CanonicalAllergy, "provenance">;
