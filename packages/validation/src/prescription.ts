import { z } from "zod";

/**
 * A prescribing event — one doctor visit's prescription (docs/07 screen 43).
 * Every field is optional: a patient photographing a prescription they can't
 * fully read should still be able to file it, and an unnamed/undated record
 * with the photo attached is far more useful than no record at all.
 */
export const createPrescriptionSchema = z.object({
  /** Free text, matching the prescriber-name UX everywhere else — deduped server-side per profile. */
  practitionerName: z.string().trim().max(120).optional(),
  prescribedAt: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;

/** Links/unlinks an existing medication to this prescription (docs/07 screen 43). */
export const linkMedicationSchema = z.object({
  medicationId: z.string().uuid(),
});
export type LinkMedicationInput = z.infer<typeof linkMedicationSchema>;
