"use client";
import { DEFAULT_TIMEZONE } from "@medpass/domain";
import { useSession } from "./session";

/**
 * Clinical times render in the PATIENT's timezone, never the viewer's
 * (docs/16): a caregiver in Houston looking at a Hyderabad profile must see
 * "8:00 AM" for the morning dose, because that is when the medicine is
 * physically taken. Every dose/schedule/measurement surface formats through
 * these helpers with the profile's zone. Viewer-centric timestamps (this
 * device's sessions, share-link access logs) deliberately keep plain
 * toLocale* formatting instead.
 */

/** The active profile's zone — the one every clinical surface formats with. */
export function useActiveTimezone(): string {
  const { profiles, activeProfileId } = useSession();
  return profiles.find((p) => p.id === activeProfileId)?.timezone ?? DEFAULT_TIMEZONE;
}

export function formatPatientTime(iso: string | Date, timezone: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: timezone });
}

export function formatPatientDate(iso: string | Date, timezone: string): string {
  return new Date(iso).toLocaleDateString([], { timeZone: timezone });
}

export function formatPatientDateTime(iso: string | Date, timezone: string): string {
  return new Date(iso).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
}

/**
 * For DATE-ONLY fields (Prisma `@db.Date`: prescription/report/check-up
 * dates), which serialize as midnight UTC. Formatting those through a
 * device zone west of UTC shifts them a day back — a Houston caregiver
 * would see "Aug 9" on an "Aug 10" prescription. A pure calendar date has
 * no zone; pin UTC so it renders as written everywhere.
 */
export function formatCalendarDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString([], { timeZone: "UTC" });
}

/** The patient's wall clock right now — the caregiver banner's "it is 8:12 PM there". */
export function patientTimeNow(timezone: string): string {
  return formatPatientTime(new Date(), timezone);
}

/** The viewer's device zone — compared against the profile zone to decide whether the banner shows. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/**
 * The reverse of the formatters above, for entry forms: a wall-clock string
 * as typed into a `datetime-local` input ("2026-09-06T21:05"), interpreted
 * in the PATIENT's zone rather than the device's. A caregiver in Houston
 * recording "the 4 PM clinic visit" means 4 PM in Hyderabad. Two-pass offset
 * resolution handles zones whose offset differs between the guess and the
 * target instant (DST edges); India has no DST, so the first pass lands.
 */
export function patientLocalToIso(local: string, timezone: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return new Date(local).toISOString();
  const [, y, mo, d, h, mi] = m.map(Number) as number[];
  const asUtc = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  let guess = asUtc - offsetMs(asUtc, timezone);
  guess = asUtc - offsetMs(guess, timezone);
  return new Date(guess).toISOString();
}

/** The `datetime-local` value for the patient's wall clock right now. */
export function patientNowLocal(timezone: string): string {
  return isoToPatientLocal(new Date().toISOString(), timezone);
}

/** ISO instant → "YYYY-MM-DDTHH:mm" in the patient's zone (prefills an edit form). */
export function isoToPatientLocal(iso: string, timezone: string): string {
  const parts = zoneParts(new Date(iso), timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** "YYYY-MM-DD" of the patient's today — the day-grouping anchor for "Today"/"Yesterday". */
export function patientTodayKey(timezone: string, now: Date = new Date()): string {
  const p = zoneParts(now, timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function zoneParts(date: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const get = (type: string) => Number(fmt.formatToParts(date).find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

function offsetMs(instant: number, timezone: string): number {
  const p = zoneParts(new Date(instant), timezone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(instant / 60_000) * 60_000;
  return wall - truncated;
}
