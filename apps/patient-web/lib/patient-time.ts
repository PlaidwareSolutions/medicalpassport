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
