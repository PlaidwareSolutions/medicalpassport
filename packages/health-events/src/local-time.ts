/**
 * ISO-8601 local date-time (no offset) for an instant in an IANA zone, e.g.
 * "2026-09-06T21:05:00" for Asia/Kolkata. Stored next to `occurredAt` so the
 * timeline can group by the patient's calendar day without re-deriving it
 * from a zone that may since have changed (V1 rule: clinical times live in
 * the patient's clock, docs/16 and hazard H-28).
 */
export function localIso(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "00";
  // Intl can emit "24" for midnight in some engines; normalise to "00".
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
}
