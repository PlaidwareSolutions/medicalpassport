import { Injectable } from "@nestjs/common";
import { proposeSlots, type SlotDose } from "@medpass/medication-terminology";
import {
  addDaysToDateString,
  AUTO_SCHEDULABLE_FREQUENCY_CODES,
  dateStringInTz,
  isDueOnDate,
  zonedTimeToInstant,
  type FrequencyCode,
} from "@medpass/domain";
import type { MedicationSchedule, ScheduleRecurrence, ScheduleStatus } from "@medpass/database";
import { PrismaService } from "../../common/prisma.service";

/**
 * Default wall-clock times per slot, interpreted in the profile's own
 * timezone (docs/16): "morning 08:00" means 08:00 wherever the patient
 * lives, DST included. "any"/"before/with/after food" only changes the
 * instruction text shown, not the due time.
 */
const DEFAULT_SLOT_TIMES: Record<SlotDose["slot"], string> = {
  morning: "08:00",
  midday: "13:00",
  night: "21:00",
};

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
      include: {
        instructions: { where: { supersededAt: null }, take: 1 },
        patientProfile: { select: { timezone: true } },
      },
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

    await this.materializeWindow(schedule, ROLLING_WINDOW_DAYS, medication.patientProfile.timezone);
  }

  /**
   * Re-anchors every current medication's future doses after a profile
   * timezone change (docs/10 H-28): tomorrow's "08:00" must be 08:00 in the
   * new place. History keeps its original instants — regeneration only
   * touches doses no one has acted on.
   */
  async regenerateForProfile(patientProfileId: string): Promise<void> {
    const medications = await this.prisma.patientMedication.findMany({
      where: { patientProfileId, deletedAt: null, status: "current" },
      select: { id: true },
    });
    for (const medication of medications) {
      await this.regenerateForMedication(medication.id);
    }
  }

  /**
   * Clears every currently-open dose so a stopped/paused/deleted medicine
   * stops nagging — not just strictly-future ones: a dose due earlier today
   * but still "upcoming" (not yet past the 2h missed-grace) was previously
   * left behind, so it kept showing as due right up until reconcile-missed-
   * doses flipped it to "missed" hours later, and *that* row was never
   * touched at all (this method only ever looked at "upcoming"), so it sat
   * in the Home "Missed" section forever. Upcoming rows are deleted rather
   * than soft-cancelled: guaranteed to have no DoseEvent yet (any recorded
   * action moves a dose out of "upcoming" first), so deletion is safe and
   * lets a later restart regenerate the same slots via materializeWindow's
   * unique constraint — a soft "cancelled" status would otherwise
   * permanently block regeneration since the (schedule, dueAt) row would
   * already exist. Missed/snoozed rows do carry real history (a snoozed
   * dose has a DoseEvent; a missed one is itself a meaningful fact) worth
   * keeping, so those are cancelled in place instead of deleted.
   */
  async cancelFutureUpcomingDoses(patientMedicationId: string): Promise<void> {
    const schedule = await this.prisma.medicationSchedule.findUnique({ where: { patientMedicationId } });
    if (!schedule) return;
    await this.prisma.scheduledDose.deleteMany({
      where: { medicationScheduleId: schedule.id, status: "upcoming" },
    });
    await this.prisma.scheduledDose.updateMany({
      where: { medicationScheduleId: schedule.id, status: { in: ["missed", "snoozed"] } },
      data: { status: "cancelled" },
    });
  }

  /**
   * Flips the schedule's own status alongside the medicine's — otherwise
   * the nightly extend-scheduled-doses cron (which only looks at
   * `status: "active"` schedules) keeps materializing brand new future
   * doses for a medicine that's been stopped or paused, forever, since
   * nothing else ever touches this field. No-op if the medicine has no
   * schedule (PRN, or never auto-schedulable).
   */
  async setScheduleStatus(patientMedicationId: string, status: ScheduleStatus): Promise<void> {
    await this.prisma.medicationSchedule.updateMany({ where: { patientMedicationId }, data: { status } });
  }

  /** Extends every active schedule's window by one day (cron: extend-scheduled-doses). */
  async extendAllActiveSchedules(): Promise<{ schedulesExtended: number; dosesCreated: number }> {
    const schedules = await this.prisma.medicationSchedule.findMany({
      where: { status: "active" },
      include: { patientMedication: { select: { patientProfile: { select: { timezone: true } } } } },
    });
    let dosesCreated = 0;
    for (const schedule of schedules) {
      const created = await this.materializeWindow(schedule, ROLLING_WINDOW_DAYS, schedule.patientMedication.patientProfile.timezone);
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
    timezone: string,
  ): Promise<number> {
    const slots = schedule.slots as unknown as ScheduleSlot[];
    const anchorDateStr = schedule.anchorDate ? schedule.anchorDate.toISOString().slice(0, 10) : null;
    const rows: Array<{ medicationScheduleId: string; dueAt: Date; slotLabel: string; quantity: number }> = [];
    // The window starts on today's calendar date *in the profile's zone* —
    // otherwise the hours/day where the zone's date and the UTC date differ
    // would materialize the wrong calendar day.
    const todayStr = dateStringInTz(timezone);
    for (let d = 0; d < days; d++) {
      const dateStr = addDaysToDateString(todayStr, d);
      if (!isDueOnDate(schedule.recurrence, anchorDateStr, dateStr)) continue;
      for (const slot of slots) {
        rows.push({
          medicationScheduleId: schedule.id,
          // DST-aware: "08:00" is 08:00 on the patient's wall clock that day.
          dueAt: zonedTimeToInstant(timezone, dateStr, slot.time),
          slotLabel: slot.slot,
          quantity: slot.quantity,
        });
      }
    }
    const result = await this.prisma.scheduledDose.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }
}
