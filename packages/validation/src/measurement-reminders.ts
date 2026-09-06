import { z } from "zod";
import { MEASUREMENT_REMINDER_DAYS, MEASUREMENT_REMINDER_MAX_TIMES_PER_CONCEPT, OBSERVATION_CONCEPTS } from "@medpass/domain";

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One concept's reminder plan (docs_v2/06 P17 "measurement reminders"):
 * local times of day in the profile's own zone and ISO weekdays (Mon = 1).
 * The cron emits one `measurement_reminder` row per (concept, day, time)
 * slot; the per-kind channel/frequency control then decides delivery.
 */
export const measurementReminderPlanSchema = z.object({
  times: z
    .array(z.string().regex(TIME_OF_DAY, "Use HH:MM"))
    .min(1)
    .max(MEASUREMENT_REMINDER_MAX_TIMES_PER_CONCEPT)
    .refine((t) => new Set(t).size === t.length, "Times must be distinct"),
  days: z
    .array(z.number().int().min(1).max(7))
    .min(1)
    .max(MEASUREMENT_REMINDER_DAYS.length)
    .refine((d) => new Set(d).size === d.length, "Days must be distinct"),
});
export type MeasurementReminderPlan = z.infer<typeof measurementReminderPlanSchema>;

/** Full replace, keyed by ObservationConcept. An empty object clears every reminder. */
export const measurementRemindersSchema = z.object({
  concepts: z.record(z.enum(OBSERVATION_CONCEPTS), measurementReminderPlanSchema),
});
export type MeasurementRemindersInput = z.infer<typeof measurementRemindersSchema>;
