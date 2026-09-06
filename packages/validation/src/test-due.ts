import { z } from "zod";
import { DIAGNOSTIC_REPORT_KINDS, TEST_DUE_STATUSES } from "@medpass/domain";

/**
 * Test-due schedules (docs_v2/05 §12, docs_v2/04 §12 `TestDueSchedule`):
 * "Next test: HbA1c Nov 20". A schedule names WHAT is due — one analyte
 * (`analyteKey`, the same free string diagnostics.ts accepts) or a whole
 * report kind (`diagnosticKind`) — and WHEN: an explicit `nextDueOn`, an
 * interval in days (recurring, anchored on the latest matching result or
 * today), or both. Never a clinical recommendation: the interval is the
 * patient's or their clinician's, typed in by them.
 */
const FUTURE_OR_TODAY = /^\d{4}-\d{2}-\d{2}$/;

const dueDate = z
  .string()
  .trim()
  .regex(FUTURE_OR_TODAY, "Use YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Not a real calendar date");

const testDueTarget = {
  analyteKey: z.string().trim().min(1).max(64).optional(),
  diagnosticKind: z.enum(DIAGNOSTIC_REPORT_KINDS).optional(),
};

export const createTestDueSchema = z
  .object({
    ...testDueTarget,
    /** What the patient calls it ("HbA1c", "Thyroid panel"); shown in reminders, so no values here. */
    label: z.string().trim().min(1).max(120),
    /** Recurring every N days (1 day … 5 years). */
    intervalDays: z.number().int().min(1).max(1826).optional(),
    /** Explicit next due date; when absent it is derived from `intervalDays`. */
    nextDueOn: dueDate.optional(),
    sourcePrescriptionId: z.string().uuid().optional(),
  })
  .refine((v) => v.analyteKey !== undefined || v.diagnosticKind !== undefined, {
    message: "Name an analyte or a report kind",
    path: ["analyteKey"],
  })
  .refine((v) => v.intervalDays !== undefined || v.nextDueOn !== undefined, {
    message: "Give a next due date or an interval in days",
    path: ["nextDueOn"],
  });
export type CreateTestDueInput = z.infer<typeof createTestDueSchema>;

export const updateTestDueSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    intervalDays: z.number().int().min(1).max(1826).nullable().optional(),
    nextDueOn: dueDate.optional(),
    /** `pending` re-arms a dismissed/done schedule; `dismissed` silences it without deleting the history. */
    status: z.enum(TEST_DUE_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateTestDueInput = z.infer<typeof updateTestDueSchema>;
