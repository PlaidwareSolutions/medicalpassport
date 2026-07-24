import { Injectable } from "@nestjs/common";
import { proposeSlots, type SlotDose } from "@medpass/medication-terminology";
import { AUTO_SCHEDULABLE_FREQUENCY_CODES, type FrequencyCode } from "@medpass/domain";
import type { MedicationSchedule, ScheduleRecurrence } from "@medpass/database";
import { PrismaService } from "../../common/prisma.service";
import { isDueOnDate } from "./recurrence";

/**
 * Default wall-clock times per slot (docs/16 simplification note: fixed
 * Asia/Kolkata defaults for this pass; per-profile customization and full
 * timezone handling are future work). "any"/"before/with/after food" only
 * changes the instruction text shown, not the due time.
 */
const DEFAULT_SLOT_TIMES: Record<SlotDose["slot"], string> = {
  morning: "08:00",
  midday: "13:00",
  night: "21:00",
};

const SCHEDULE_TIMEZONE_OFFSET = "+05:30"; // Asia/Kolkata, fixed (no DST)
const ROLLING_WINDOW_DAYS = 14;

/** Which ScheduleRecurrence a given frequency code derives (docs/09 §6). */
const FREQUENCY_RECURRENCE: Partial<Record<FrequencyCode, ScheduleRecurrence>> = {
  OD: "daily",
  OD_AFTERNOON: "daily",
  BD: "daily",
  TDS: "daily",
  HS: "daily",
  PATTERN: "daily",
  WEEKLY: "weekly",
  FORTNIGHTLY: "fortnightly",
  MONTHLY: "monthly",
};

interface ScheduleSlot {
  slot: SlotDose["slot"];
  time: string;
  quantity: number;
}

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Regenerates the schedule for a medication from its current confirmed
   * instruction. Called on medication create, instruction update, and status
   * transitions back to "current". Idempotent: safe to call repeatedly.
   */
  async regenerateForMedication(patientMedicationId: string): Promise<void> {
    const medication = await this.prisma.patientMedication.findUniqueOrThrow({
      where: { id: patientMedicationId },
      include: { instructions: { where: { supersededAt: null }, take: 1 } },
    });
    const instruction = medication.instructions[0];

    // Cancel future upcoming doses from any prior schedule — regeneration
    // always starts clean rather than layering stale slots.
    await this.cancelFutureUpcomingDoses(patientMedicationId);

    if (medication.status !== "current" || medication.isPrn || !instruction) {
      return; // PRN and non-current medications have no scheduled doses.
    }
    if (!AUTO_SCHEDULABLE_FREQUENCY_CODES.includes(instruction.frequencyCode)) {
      return; // QID/ALTERNATE_DAY/CUSTOM need explicit setup, not yet built (docs/09 §6).
    }

    const proposed = proposeSlots(instruction.frequencyCode, instruction.pattern ?? undefined);
    if (!proposed) return; // Ambiguous pattern — never silently schedule.

    const slots: ScheduleSlot[] = proposed.map((s) => ({
      slot: s.slot,
      time: DEFAULT_SLOT_TIMES[s.slot],
      quantity: s.quantity,
    }));
    const recurrence = FREQUENCY_RECURRENCE[instruction.frequencyCode] ?? "daily";
    // Weekly/fortnightly/monthly anchor to the medication's own start date
    // (day-of-week / day-of-month comes from it) — defaults to "today" the
    // same way patientMedication.startDate itself defaults on create.
    const anchorDate = recurrence === "daily" ? null : (medication.startDate ?? new Date());

    const schedule = await this.prisma.medicationSchedule.upsert({
      where: { patientMedicationId },
      create: { patientMedicationId, slots: slots as object, recurrence, anchorDate, status: "active" },
      update: { slots: slots as object, recurrence, anchorDate, status: "active" },
    });

    await this.materializeWindow(schedule, ROLLING_WINDOW_DAYS);
  }

  /**
   * Clears not-yet-happened doses so a stopped/paused medicine stops
   * nagging. Deletes rather than soft-cancels: a still-"upcoming" row is
   * guaranteed to have no DoseEvent yet (any recorded action moves it out of
   * "upcoming" first), so deletion is safe and lets resume cleanly
   * regenerate the same slots via materializeWindow's unique constraint —
   * a soft "cancelled" status would otherwise permanently block
   * regeneration since the (schedule, dueAt) row would already exist.
   * Snoozed doses (which do have an event) are left for the missed-dose
   * reconciliation cron rather than force-deleted.
   */
  async cancelFutureUpcomingDoses(patientMedicationId: string): Promise<void> {
    const schedule = await this.prisma.medicationSchedule.findUnique({ where: { patientMedicationId } });
    if (!schedule) return;
    await this.prisma.scheduledDose.deleteMany({
      where: { medicationScheduleId: schedule.id, status: "upcoming", dueAt: { gt: new Date() } },
    });
  }

  /** Extends every active schedule's window by one day (cron: extend-scheduled-doses). */
  async extendAllActiveSchedules(): Promise<{ schedulesExtended: number; dosesCreated: number }> {
    const schedules = await this.prisma.medicationSchedule.findMany({ where: { status: "active" } });
    let dosesCreated = 0;
    for (const schedule of schedules) {
      const created = await this.materializeWindow(schedule, ROLLING_WINDOW_DAYS);
      dosesCreated += created;
    }
    return { schedulesExtended: schedules.length, dosesCreated };
  }

  /** Marks doses past their due window (+2h grace) as missed (cron: reconcile-missed-doses). */
  async reconcileMissedDoses(graceHours = 2): Promise<{ missed: number }> {
    const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000);
    const result = await this.prisma.scheduledDose.updateMany({
      where: {
        status: "upcoming",
        dueAt: { lt: cutoff },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: cutoff } }],
      },
      data: { status: "missed" },
    });
    return { missed: result.count };
  }

  /**
   * Idempotently creates ScheduledDose rows for [today, today+days),
   * skipping ones that exist. For daily recurrence every day in the window
   * gets a dose; for weekly/fortnightly/monthly only the days that match
   * the schedule's anchorDate do (docs/09 §6) — so a monthly schedule may
   * materialize zero rows on a given call and pick up its next occurrence
   * once the sliding window (extended one day further by the daily
   * extend-scheduled-doses cron) reaches it.
   */
  private async materializeWindow(
    schedule: Pick<MedicationSchedule, "id" | "slots" | "recurrence" | "anchorDate">,
    days: number,
  ): Promise<number> {
    const slots = schedule.slots as unknown as ScheduleSlot[];
    const anchorDateStr = schedule.anchorDate ? schedule.anchorDate.toISOString().slice(0, 10) : null;
    const rows: Array<{ medicationScheduleId: string; dueAt: Date; slotLabel: string; quantity: number }> = [];
    // IST-shifted "now" so the calendar date is the IST date, not the UTC
    // date — otherwise the ~5.5h/day window where they differ (UTC evening
    // = IST past-midnight) would materialize the wrong calendar day.
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    for (let d = 0; d < days; d++) {
      const day = new Date(istNow);
      day.setUTCDate(day.getUTCDate() + d);
      const dateStr = day.toISOString().slice(0, 10);
      if (!isDueOnDate(schedule.recurrence, anchorDateStr, dateStr)) continue;
      for (const slot of slots) {
        rows.push({
          medicationScheduleId: schedule.id,
          dueAt: new Date(`${dateStr}T${slot.time}:00${SCHEDULE_TIMEZONE_OFFSET}`),
          slotLabel: slot.slot,
          quantity: slot.quantity,
        });
      }
    }
    const result = await this.prisma.scheduledDose.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }
}
