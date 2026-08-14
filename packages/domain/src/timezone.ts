/**
 * Per-profile timezone support (docs/16). A patient profile's clinical day —
 * dose times, "today", quiet hours — is anchored to the profile's own IANA
 * timezone, regardless of where a viewer (a caregiver abroad) or a server
 * happens to sit. Pure Intl-based, no timezone library: Node ships full ICU
 * and every target browser implements Intl.DateTimeFormat with the IANA
 * database, so the platform's own tables are the single source of truth.
 */

/** Every profile's default — the launch market (docs/16). */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsInTz(tz: string, at: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) map[p.type] = p.value;
  // ICU may render midnight as "24" with hour12: false.
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour === "24" ? 0 : Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** The zone's UTC offset in minutes at a given instant (DST-aware; IST is always +330). */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const p = partsInTz(tz, at);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // formatToParts has second precision; round away sub-minute noise.
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/** "YYYY-MM-DD" calendar date in the zone at a given instant. */
export function dateStringInTz(tz: string, at: Date = new Date()): string {
  // en-CA's numeric date format is YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Minutes since local midnight in the zone — quiet-hours comparisons. */
export function minutesSinceMidnightInTz(tz: string, at: Date = new Date()): number {
  const p = partsInTz(tz, at);
  return p.hour * 60 + p.minute;
}

/**
 * The absolute instant of a wall-clock time in a zone ("2026-03-08" +
 * "08:00" in America/Chicago → 14:00Z). Two-pass offset resolution
 * converges for every real zone. A nonexistent wall time (the spring-
 * forward gap, once a year at ~02:xx) deterministically resolves one wall
 * hour EARLY — for a reminder, early beats late; no default dose slot sits
 * in the gap anyway. An ambiguous fall-back time resolves to one of its two
 * occurrences deterministically.
 */
export function zonedTimeToInstant(tz: string, dateStr: string, hhmm: string): Date {
  const utcGuess = Date.parse(`${dateStr}T${hhmm}:00Z`);
  let ts = utcGuess - tzOffsetMinutes(tz, new Date(utcGuess)) * 60_000;
  ts = utcGuess - tzOffsetMinutes(tz, new Date(ts)) * 60_000;
  return new Date(ts);
}

/** dateStr + n days — pure calendar arithmetic on "YYYY-MM-DD", no zone involved. */
export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
