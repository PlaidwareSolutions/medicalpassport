import { z } from "zod";
import { DOSE_UNITS, FOOD_INSTRUCTIONS, FREQUENCY_CODES, MEDICATION_SOURCES, MEDICATION_STATUSES } from "@medpass/domain";

/**
 * Typed dosing instruction (docs/07 screen 18). Dose amounts come from
 * pickers — free-text doses are not accepted.
 */
export const instructionSchema = z
  .object({
    doseQuantity: z.coerce.number().positive().max(100),
    doseUnit: z.enum(DOSE_UNITS),
    frequencyCode: z.enum(FREQUENCY_CODES),
    /** Morning-noon-night pattern such as "1-0-1"; required for PATTERN. */
    pattern: z
      .string()
      .regex(/^\d(\.\d)?-\d(\.\d)?-\d(\.\d)?$/)
      .optional(),
    foodInstruction: z.enum(FOOD_INSTRUCTIONS).default("any"),
    durationDays: z.coerce.number().int().positive().max(365).optional(),
    /** Original captured text (e.g. OCR or user-entered shorthand). Preserved verbatim. */
    originalText: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.frequencyCode === "PATTERN" && !v.pattern) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "Pattern (e.g. 1-0-1) is required" });
    }
    // SOS (as-needed) cannot carry a fixed pattern — ambiguous combos are
    // rejected, never silently interpreted (docs/07 screen 18, hazard H-16).
    if (v.frequencyCode === "SOS" && v.pattern) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pattern"],
        message: "As-needed (SOS) medicines cannot have a fixed daily pattern",
      });
    }
  });
export type InstructionInput = z.infer<typeof instructionSchema>;

/** Patient-entered supply snapshot (docs/07 screen 27) — never inferred. */
const quantityOnHandSchema = z.coerce.number().nonnegative().max(100_000);

export const createMedicationSchema = z
  .object({
    /** Either a catalog product reference or a free-text entered name. */
    productId: z.string().uuid().optional(),
    enteredName: z.string().trim().min(1).max(200).optional(),
    patientReason: z.string().trim().max(500).optional(),
    prescriberName: z.string().trim().max(120).optional(),
    /** Optional evidence: the prescription record this medicine came from (docs/07 screen 43). */
    prescriptionId: z.string().uuid().nullable().optional(),
    source: z.enum(MEDICATION_SOURCES),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    isPrn: z.boolean().default(false),
    quantityOnHand: quantityOnHandSchema.optional(),
    /** Patient opt-in only (docs/16) — never inferred clinical severity. */
    criticalEscalation: z.boolean().default(false),
    instruction: instructionSchema,
  })
  .superRefine((v, ctx) => {
    if (!v.productId && !v.enteredName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enteredName"],
        message: "Choose a medicine from search or enter its name",
      });
    }
    if (v.startDate && v.endDate && v.endDate < v.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "End date is before start date" });
    }
  });
export type CreateMedicationInput = z.infer<typeof createMedicationSchema>;

export const updateMedicationSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  patientReason: z.string().trim().max(500).optional(),
  /** An empty string clears the prescriber link rather than creating an unnamed record. */
  prescriberName: z.string().trim().max(120).optional(),
  /** Null explicitly unlinks this medicine from its prescription record. */
  prescriptionId: z.string().uuid().nullable().optional(),
  /** Anchor date for weekly/fortnightly/monthly frequencies (day-of-week /
   * day-of-month comes from it) — editable so switching an existing
   * medicine onto one of those frequencies can set/move the anchor. */
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  quantityOnHand: quantityOnHandSchema.nullable().optional(),
  criticalEscalation: z.boolean().optional(),
  instruction: instructionSchema.optional(),
});
export type UpdateMedicationInput = z.infer<typeof updateMedicationSchema>;

export const changeMedicationStatusSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  status: z.enum(MEDICATION_STATUSES),
  reason: z.string().trim().max(500).optional(),
});
export type ChangeMedicationStatusInput = z.infer<typeof changeMedicationStatusSchema>;

/** "Mark refilled" (docs/07 screen 27) — a semantically distinct event from a plain edit (its own audit action). */
export const recordRefillSchema = z.object({
  rowVersion: z.number().int().nonnegative(),
  quantityOnHand: quantityOnHandSchema,
});
export type RecordRefillInput = z.infer<typeof recordRefillSchema>;
