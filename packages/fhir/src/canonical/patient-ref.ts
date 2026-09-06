/** Minimal patient reference the serializer needs; never the full profile. */
export interface CanonicalPatientRef {
  patientProfileId: string;
  /** ABHA address (e.g. `name@sbx`), when linked. Exported as an identifier on the reference. */
  abhaAddress?: string | null;
  /** Display name for the reference; optional so exports can omit PII when not required. */
  display?: string | null;
}
