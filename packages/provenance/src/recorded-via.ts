/** Channel that wrote the row (docs_v2/04 §1.2 `recordedVia`). Allowlist, not free text. */
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

export function isRecordedVia(value: unknown): value is RecordedVia {
  return typeof value === "string" && (RECORDED_VIA as readonly string[]).includes(value);
}
