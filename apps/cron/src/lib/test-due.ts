/**
 * `test_due` detection (docs_v2/05 §12, docs_v2/04 §12 `TestDueSchedule`):
 * "Next test: HbA1c Nov 20". Detection only — the every-minute
 * detect-due-reminders pass dispatches the pending rows it leaves behind,
 * applying the per-kind channel/frequency control, quiet hours and the
 * daily cap (H-48) exactly as for every other kind.
 *
 * For each pending schedule whose `dueOn` has arrived on the patient's own
 * calendar:
 *  - If a matching result (same analyte, or a report of the same kind) has
 *    been recorded on or after `dueOn`, the test happened: a recurring
 *    schedule rolls forward from that result's date; a one-off becomes
 *    `done`. No reminder is sent.
 *  - Otherwise one `test_due` notification is queued, keyed on the
 *    schedule and the due date so a re-run is a no-op; a recurring
 *    schedule then rolls forward by its interval, a one-off becomes
 *    `notified` (the schedule stays on the patient's list until they mark
 *    it done or dismiss it).
 *
 * The same "latest matching result" query the API uses for `lastDoneOn`
 * lives here so both sides agree on what counts as done.
 */
import { addDaysToDateString, dateStringInTz } from "@medpass/domain";
import type { Prisma, PrismaClient } from "@medpass/database";

type Db = PrismaClient | Prisma.TransactionClient;

export function testDueKey(scheduleId: string, dueOn: string): string {
  return `test_due:${scheduleId}:${dueOn}`;
}

export function parseTestDueKey(dedupeKey: string): { scheduleId: string; dueOn: string } | null {
  const m = /^test_due:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i.exec(dedupeKey);
  return m ? { scheduleId: m[1]!, dueOn: m[2]! } : null;
}

/** `@db.Date` columns round-trip as UTC midnight; the calendar date is the first ten ISO characters. */
export function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The calendar date of the latest non-deleted DiagnosticReport matching
 * the schedule — by analyte (any result row with that `analyteKey`) or by
 * report kind. `testedAt` wins, then `reportedAt`, then `createdAt`, so a
 * report a patient typed in without a date still counts as done today.
 */
export async function latestMatchingResultDate(
  db: Db,
  profileId: string,
  target: { analyteKey: string | null; diagnosticKind: string | null },
): Promise<string | null> {
  const where: Prisma.DiagnosticReportWhereInput = {
    patientProfileId: profileId,
    deletedAt: null,
    status: { not: "cancelled" },
    ...(target.analyteKey ? { results: { some: { analyteKey: target.analyteKey, deletedAt: null } } } : {}),
    ...(target.diagnosticKind ? { kind: target.diagnosticKind as never } : {}),
  };
  const reports = await db.diagnosticReport.findMany({
    where,
    select: { testedAt: true, reportedAt: true, createdAt: true },
    orderBy: [{ testedAt: "desc" }, { reportedAt: "desc" }, { createdAt: "desc" }],
    take: 25,
  });
  let latest: string | null = null;
  for (const r of reports) {
    const when = r.testedAt ? dateOnly(r.testedAt) : r.reportedAt ? dateOnly(r.reportedAt) : dateOnly(r.createdAt);
    if (latest === null || when > latest) latest = when;
  }
  return latest;
}

export interface DetectTestDueSummary {
  queued: number;
  rolledForward: number;
  completed: number;
}

export async function detectTestDue(prisma: PrismaClient, options: { now?: Date } = {}): Promise<DetectTestDueSummary> {
  const now = options.now ?? new Date();
  const summary: DetectTestDueSummary = { queued: 0, rolledForward: 0, completed: 0 };

  const schedules = await prisma.testDueSchedule.findMany({
    where: { status: "pending", deletedAt: null },
    include: { patientProfile: { select: { id: true, timezone: true, deletedAt: true, notificationPreference: { select: { privacyMode: true } } } } },
    orderBy: { dueOn: "asc" },
  });

  for (const schedule of schedules) {
    if (schedule.patientProfile.deletedAt) continue;
    const today = dateStringInTz(schedule.patientProfile.timezone, now);
    const dueOn = dateOnly(schedule.dueOn);
    if (dueOn > today) continue;

    const lastDone = await latestMatchingResultDate(prisma, schedule.patientProfileId, schedule);
    if (lastDone !== null && lastDone >= dueOn) {
      // The test was done: no reminder. Recurring → next from the result date; one-off → done.
      if (schedule.recurrenceDays) {
        const next = addDaysToDateString(lastDone, schedule.recurrenceDays);
        await prisma.testDueSchedule.update({ where: { id: schedule.id }, data: { dueOn: new Date(`${next}T00:00:00Z`) } });
        summary.rolledForward++;
      } else {
        await prisma.testDueSchedule.update({ where: { id: schedule.id }, data: { status: "done" } });
        summary.completed++;
      }
      continue;
    }

    const dedupeKey = testDueKey(schedule.id, dueOn);
    const existing = await prisma.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (!existing) {
      await prisma.notification.create({
        data: {
          patientProfileId: schedule.patientProfileId,
          kind: "test_due",
          privacyMode: schedule.patientProfile.notificationPreference?.privacyMode ?? "generic",
          dedupeKey,
          status: "pending",
        },
      });
      summary.queued++;
    }

    if (schedule.recurrenceDays) {
      // Roll forward from the due date, not from today, so the cadence never
      // drifts — but past today, so a schedule overdue by several intervals
      // gets one reminder now rather than one per day until it catches up.
      let next = addDaysToDateString(dueOn, schedule.recurrenceDays);
      while (next <= today) next = addDaysToDateString(next, schedule.recurrenceDays);
      await prisma.testDueSchedule.update({ where: { id: schedule.id }, data: { dueOn: new Date(`${next}T00:00:00Z`) } });
      summary.rolledForward++;
    } else {
      await prisma.testDueSchedule.update({ where: { id: schedule.id }, data: { status: "notified" } });
    }
  }

  return summary;
}
