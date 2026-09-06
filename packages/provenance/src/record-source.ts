/**
 * Where a clinical value came from (docs_v2/04 §1.2, ADR-V2-002).
 * Extends the V1 `RecordSource` enum (patient/document/professional); the V1
 * values are mapped by {@link LEGACY_RECORD_SOURCE_MAP} during backfill and
 * removed in the sunset migration.
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

/** V1 `RecordSource` values that still exist until the sunset migration. */
export const LEGACY_RECORD_SOURCES = ["patient", "document", "professional"] as const;
export type LegacyRecordSource = (typeof LEGACY_RECORD_SOURCES)[number];

/** V1 -> V2 mapping used by the provenance backfill (docs_v2/04 §1.2 rules). */
export const LEGACY_RECORD_SOURCE_MAP: Readonly<Record<LegacyRecordSource, RecordSource>> = {
  patient: "user_entered",
  document: "ocr_extracted",
  professional: "clinic_entered",
};

export function isRecordSource(value: unknown): value is RecordSource {
  return typeof value === "string" && (RECORD_SOURCES as readonly string[]).includes(value);
}

export function isLegacyRecordSource(value: unknown): value is LegacyRecordSource {
  return typeof value === "string" && (LEGACY_RECORD_SOURCES as readonly string[]).includes(value);
}

/** Accepts either a V2 source or a V1 legacy value and returns the V2 source. */
export function normalizeRecordSource(value: RecordSource | LegacyRecordSource): RecordSource {
  return isLegacyRecordSource(value) ? LEGACY_RECORD_SOURCE_MAP[value] : value;
}
