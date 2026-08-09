import { z } from "zod";

/**
 * "My doctors" (docs/07 screen 43 follow-up): the per-profile Practitioner
 * records behind every prescriber/doctor field. Names stay free text —
 * the same 120-char bound the inline prescriberName/practitionerName
 * fields use — so a doctor created here and one typed inline dedupe to
 * the same row.
 */
export const createPractitionerSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  speciality: z.string().trim().min(1).max(120).optional(),
});
export type CreatePractitionerInput = z.infer<typeof createPractitionerSchema>;

export const updatePractitionerSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  /** An empty string clears the speciality. */
  speciality: z.string().trim().max(120).optional(),
});
export type UpdatePractitionerInput = z.infer<typeof updatePractitionerSchema>;

export const mergePractitionerSchema = z.object({
  /** The surviving record — everything linked to :id is repointed to it. */
  targetId: z.string().uuid(),
});
export type MergePractitionerInput = z.infer<typeof mergePractitionerSchema>;
