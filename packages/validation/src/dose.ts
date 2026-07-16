import { z } from "zod";
import { DOSE_ACTIONS } from "@medpass/domain";

export const recordDoseEventSchema = z
  .object({
    action: z.enum(DOSE_ACTIONS),
    /** Required for "taken_other_time"; otherwise defaults to now. */
    effectiveAt: z.coerce.date().optional(),
    /** Minutes to snooze; required when action is "snoozed". */
    snoozeMinutes: z.coerce.number().int().min(1).max(180).optional(),
    /** Offline idempotency key (docs/15) — retries resolve to one event. */
    clientMutationId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "snoozed" && !v.snoozeMinutes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["snoozeMinutes"], message: "Snooze duration is required" });
    }
    if (v.action === "taken_other_time" && !v.effectiveAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["effectiveAt"], message: "Enter when it was actually taken" });
    }
  });
export type RecordDoseEventInput = z.infer<typeof recordDoseEventSchema>;

export const recordPrnDoseEventSchema = z.object({
  patientMedicationId: z.string().uuid(),
  action: z.enum(["taken", "could_not_take", "problem"]),
  effectiveAt: z.coerce.date().optional(),
  clientMutationId: z.string().uuid().optional(),
});
export type RecordPrnDoseEventInput = z.infer<typeof recordPrnDoseEventSchema>;

export const timelineQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
