import type { CanonicalProvenance } from "./provenance.js";

export const PATIENT_SEXES = ["male", "female", "other", "unknown"] as const;
export type PatientSex = (typeof PATIENT_SEXES)[number];

/**
 * Canonical patient identity for export (docs_v2/04 §2 `PatientProfile`, docs_v2/08 §6 / §8 "identity").
 * Only what a receiver needs: no phone, no emergency card, no guardian data. The ABHA number is
 * included only when the API decided the receiver may see it (the patient's own export does).
 */
export interface CanonicalPatient {
  id: string;
  displayName: string;
  /** Four-digit year; exported as a FHIR partial `birthDate`. */
  yearOfBirth: number | null;
  sex: PatientSex | null;
  abhaAddress: string | null;
  abhaNumber: string | null;
  /** The profile row's own recording facts (owner, created-at); `null` fails closed like every artifact. */
  provenance: CanonicalProvenance | null;
}
