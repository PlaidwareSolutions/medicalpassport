/**
 * Extends every active medication schedule's rolling dose window by one day
 * (docs/25 cron schedule). Idempotent: ScheduledDose has a unique constraint
 * on (medicationScheduleId, dueAt), so re-running never creates duplicates.
 *
 * Mirrors the materialization logic in apps/api's SchedulingService — kept
 * duplicated rather than shared because the cron app has no NestJS
 * dependency and this is a handful of lines (docs/02: no premature
 * abstraction).
 */
import { addDaysToDateString, dateStringInTz, isDueOnDate, zonedTimeToInstant } from "@medpass/domain";
import { runJob } from "../lib/run-job";

const WINDOW_DAYS = 14;

interface ScheduleSlot {
  slot: string;
  time: string;
  quantity: number;
}

runJob("extend-scheduled-doses", async ({ prisma, log }) => {
  const schedules = await prisma.medicationSchedule.findMany({
    where: { status: "active" },
    include: { patientMedication: { select: { patientProfile: { select: { timezone: true } } } } },
  });
  let dosesCreated = 0;

  for (const schedule of schedules) {
    const timezone = schedule.patientMedication.patientProfile.timezone;
    const slots = schedule.slots as unknown as ScheduleSlot[];
    const anchorDateStr = schedule.anchorDate ? schedule.anchorDate.toISOString().slice(0, 10) : null;
    const rows: Array<{ medicationScheduleId: string; dueAt: Date; slotLabel: string; quantity: number }> = [];
    // The window starts on today's calendar date in the profile's own zone
    // (matches apps/api's SchedulingService.materializeWindow).
    const todayStr = dateStringInTz(timezone);
    for (let d = 0; d < WINDOW_DAYS; d++) {
      const dateStr = addDaysToDateString(todayStr, d);
      // Recurrence gate: previously missing here, so this nightly job
      // materialized weekly/fortnightly/monthly schedules on every day of
      // the window — the api-side materializer always filtered, and its
      // rows arrived first, so the bug showed as extra daily doses only
      // after day 14 of a non-daily schedule's life.
      if (!isDueOnDate(schedule.recurrence, anchorDateStr, dateStr)) continue;
      for (const slot of slots) {
        rows.push({
          medicationScheduleId: schedule.id,
          dueAt: zonedTimeToInstant(timezone, dateStr, slot.time),
          slotLabel: slot.slot,
          quantity: slot.quantity,
        });
      }
    }
    const result = await prisma.scheduledDose.createMany({ data: rows, skipDuplicates: true });
    dosesCreated += result.count;
  }

  log.info({ schedulesChecked: schedules.length, dosesCreated }, "extended rolling windows");
  return { schedulesChecked: schedules.length, dosesCreated };
});
