/**
 * Canonical provenance block — mirrors docs_v2/04 §1.2.
 * Plain DTO: services stamp it from the row; clients never set it.
 */

export const RECORD_SOURCES = [
  "user_entered",
  "caregiver_entered",
  "ocr_extracted",
  "clinic_entered",
  "lab_imported",
  "pharmacy_entered",
  "device_recorded",
  "abdm_imported",
  "system_derived",
] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

/** Monotonic: only ever moves up in this order. */
export const VERIFICATION_STATES = [
  "unverified",
  "patient_confirmed",
  "provider_verified",
  "source_authenticated",
] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const RECORDED_VIA = [
  "pwa",
  "native_android",
  "native_ios",
  "clinic_portal",
  "pharmacy_portal",
  "lab_api",
  "abdm",
  "worker",
] as const;
export type RecordedVia = (typeof RECORDED_VIA)[number];

export interface CanonicalProvenance {
  source: RecordSource;
  verification: VerificationState;
  /** Who pressed save. */
  recordedByUserId: string | null;
  recordedVia: RecordedVia;
  /** ISO-8601 instant (with offset) when the row was recorded. */
  recordedAt: string;
  sourceDocumentId?: string | null;
  sourceExtractionId?: string | null;
  sourceDeviceId?: string | null;
  sourceAbdmTxnId?: string | null;
  sourceOrganizationId?: string | null;
  sourcePractitionerId?: string | null;
  verifiedByUserId?: string | null;
  /** ISO-8601 instant. */
  verifiedAt?: string | null;
}

/** Only these states may be shown to a receiver as FHIR `confirmed` (docs_v2/10: patient-entered is never provider-authenticated). */
export const AUTHENTICATED_VERIFICATION_STATES: ReadonlySet<VerificationState> = new Set([
  "provider_verified",
  "source_authenticated",
]);
