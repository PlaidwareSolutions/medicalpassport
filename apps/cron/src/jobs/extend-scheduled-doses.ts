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
import { runJob } from "../lib/run-job";

const SCHEDULE_TIMEZONE_OFFSET = "+05:30"; // Asia/Kolkata, fixed (matches api)
const WINDOW_DAYS = 14;

interface ScheduleSlot {
  slot: string;
  time: string;
  quantity: number;
}

runJob("extend-scheduled-doses", async ({ prisma, log }) => {
  const schedules = await prisma.medicationSchedule.findMany({ where: { status: "active" } });
  let dosesCreated = 0;

  for (const schedule of schedules) {
    const slots = schedule.slots as unknown as ScheduleSlot[];
    const rows: Array<{ medicationScheduleId: string; dueAt: Date; slotLabel: string; quantity: number }> = [];
    // IST-shifted "now" so the calendar date is the IST date, not the UTC
    // date (matches apps/api's SchedulingService.materializeWindow).
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    for (let d = 0; d < WINDOW_DAYS; d++) {
      const day = new Date(istNow);
      day.setUTCDate(day.getUTCDate() + d);
      const dateStr = day.toISOString().slice(0, 10);
      for (const slot of slots) {
        rows.push({
          medicationScheduleId: schedule.id,
          dueAt: new Date(`${dateStr}T${slot.time}:00${SCHEDULE_TIMEZONE_OFFSET}`),
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
