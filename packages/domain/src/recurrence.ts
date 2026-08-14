/**
 * Mirrors the Prisma `ScheduleRecurrence` enum — typed locally because this
 * package sits below `@medpass/database` and the cron app (which has no
 * NestJS/api dependency) needs this function too.
 */
export type ScheduleRecurrenceCode = "daily" | "weekly" | "fortnightly" | "monthly";

/** Days in a given UTC month (0-indexed month, matching Date#getUTCMonth). */
function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/**
 * Monthly recurrence lands on the anchor's day-of-month, clamped to the
 * last day of a shorter month (e.g. an anchor of the 31st recurs on the
 * 28th/29th in February) — never rolls over into the next month.
 */
function isMonthlyMatch(anchor: Date, day: Date): boolean {
  const effectiveDom = Math.min(anchor.getUTCDate(), daysInMonth(day.getUTCFullYear(), day.getUTCMonth()));
  return day.getUTCDate() === effectiveDom;
}

/**
 * Whether a calendar date is a due date for a given recurrence, anchored to
 * the medication's start date. Dates before the anchor are never due (a
 * schedule never predates when the patient actually started taking it).
 * Pure and timezone-agnostic by design: both dates are plain "YYYY-MM-DD"
 * calendar days (the IST-shifted calendar date, in practice — see
 * SchedulingService), never wall-clock instants.
 */
export function isDueOnDate(recurrence: ScheduleRecurrenceCode, anchorDateStr: string | null, dateStr: string): boolean {
  if (recurrence === "daily") return true;
  if (!anchorDateStr || dateStr < anchorDateStr) return false;

  const anchor = new Date(`${anchorDateStr}T00:00:00Z`);
  const day = new Date(`${dateStr}T00:00:00Z`);

  switch (recurrence) {
    case "weekly": {
      const diffDays = Math.round((day.getTime() - anchor.getTime()) / 86_400_000);
      return diffDays % 7 === 0;
    }
    case "fortnightly": {
      const diffDays = Math.round((day.getTime() - anchor.getTime()) / 86_400_000);
      return diffDays % 14 === 0;
    }
    case "monthly":
      return isMonthlyMatch(anchor, day);
    default:
      return false;
  }
}
