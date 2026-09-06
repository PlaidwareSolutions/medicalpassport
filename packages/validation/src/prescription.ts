import { z } from "zod";
import { DOSE_UNITS, FOOD_INSTRUCTIONS, FREQUENCY_CODES } from "@medpass/domain";

/**
 * One line item as written on the prescription (docs_v2/04 §4.1
 * `PrescriptionItem`) — separate from the patient's current medicine, so a
 * line can be "prescribed but never started". Only the name is required:
 * the doctor's handwriting is routinely only half-legible, and a line with
 * just a name is still worth keeping. Dose/frequency/food come from the same
 * pickers as add-medicine, never free text for a hazard-critical field.
 */
const prescriptionItemFields = {
  enteredName: z.string().trim().min(1).max(200),
  productId: z.string().uuid().nullable().optional(),
  strengthLabel: z.string().trim().max(60).nullable().optional(),
  formText: z.string().trim().max(60).nullable().optional(),
  routeText: z.string().trim().max(60).nullable().optional(),
  doseQuantity: z.coerce.number().positive().max(1000).nullable().optional(),
  doseUnit: z.enum(DOSE_UNITS).nullable().optional(),
  frequencyCode: z.enum(FREQUENCY_CODES).nullable().optional(),
  pattern: z
    .string()
    .regex(/^\d(\.\d)?-\d(\.\d)?-\d(\.\d)?$/)
    .nullable()
    .optional(),
  foodInstruction: z.enum(FOOD_INSTRUCTIONS).nullable().optional(),
  durationDays: z.coerce.number().int().positive().max(365).nullable().optional(),
  /** Free-text instructions as written ("after food for 5 days") — preserved verbatim, never interpreted. */
  instructionsText: z.string().trim().max(500).nullable().optional(),
  /** Order on the paper; assigned server-side when omitted. */
  sequence: z.coerce.number().int().positive().max(200).optional(),
};

function refineItem(v: { frequencyCode?: string | null; pattern?: string | null }, ctx: z.RefinementCtx) {
  if (v.frequencyCode === "PATTERN" && !v.pattern) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "Pattern (e.g. 1-0-1) is required" });
  }
  if (v.frequencyCode === "SOS" && v.pattern) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pattern"], message: "As-needed (SOS) medicines cannot have a fixed daily pattern" });
  }
}

export const prescriptionItemSchema = z.object(prescriptionItemFields).superRefine(refineItem);
export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;

export const updatePrescriptionItemSchema = z
  .object({ ...prescriptionItemFields, enteredName: prescriptionItemFields.enteredName.optional() })
  .superRefine(refineItem);
export type UpdatePrescriptionItemInput = z.infer<typeof updatePrescriptionItemSchema>;

/**
 * A prescribing event — one doctor visit's prescription (docs/07 screen 43).
 * Every field is optional: a patient photographing a prescription they can't
 * fully read should still be able to file it, and an unnamed/undated record
 * with the photo attached is far more useful than no record at all.
 */
export const createPrescriptionSchema = z
  .object({
    /** Free text, matching the prescriber-name UX everywhere else — deduped server-side per profile. */
    practitionerName: z.string().trim().max(120).optional(),
    prescribedAt: z.coerce.date().optional(),
    notes: z.string().trim().max(1000).optional(),
    /** V2 Phase 1: the visit this prescription belongs to (docs_v2/04 §3.3); must be one of this profile's encounters. */
    encounterId: z.string().uuid().nullable().optional(),
    /** V2 Phase 2 (docs_v2/05 §4): as written on the paper — never inferred. */
    diagnosisText: z.string().trim().max(500).nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    followUpOn: z.coerce.date().nullable().optional(),
    items: z.array(prescriptionItemSchema).max(30).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.prescribedAt && v.validUntil && v.validUntil < v.prescribedAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["validUntil"], message: "Valid-until is before the prescription date" });
    }
  });
export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;

/** Links/unlinks an existing medication to this prescription (docs/07 screen 43). */
export const linkMedicationSchema = z.object({
  medicationId: z.string().uuid(),
});
export type LinkMedicationInput = z.infer<typeof linkMedicationSchema>;

/**
 * "Start this medicine" from a line item (docs_v2/05 §4). The line's own
 * dose/frequency/food carry over; anything the paper left out (or the
 * patient wants to correct before starting) is supplied here through the
 * same pickers. A line with no dose and no override is refused — a medicine
 * is never started with a guessed dose.
 */
export const startMedicationFromItemSchema = z.object({
  doseQuantity: z.coerce.number().positive().max(100).optional(),
  doseUnit: z.enum(DOSE_UNITS).optional(),
  frequencyCode: z.enum(FREQUENCY_CODES).optional(),
  pattern: z
    .string()
    .regex(/^\d(\.\d)?-\d(\.\d)?-\d(\.\d)?$/)
    .optional(),
  foodInstruction: z.enum(FOOD_INSTRUCTIONS).optional(),
  startDate: z.coerce.date().optional(),
  quantityOnHand: z.coerce.number().nonnegative().max(100_000).optional(),
  patientReason: z.string().trim().max(500).optional(),
});
export type StartMedicationFromItemInput = z.infer<typeof startMedicationFromItemSchema>;
