import { z } from "zod";

/**
 * Treatment journey (docs_v2/06 P10). Two contracts live here:
 *
 * 1. `ClinicalRelationship` edges — condition ↔ medicine ↔ result ↔
 *    measurement ↔ provider. There is deliberately no create schema: edges
 *    are read off links the patient already recorded, and the only writes
 *    are the patient answering "yes" or "no" to a suggestion.
 * 2. The before/after view — the numbers around a medicine's start date and
 *    at roughly 30 and 90 days after it. The query names *what* to line up;
 *    it can never ask for a comparison, because the endpoint does not make
 *    one (docs_v2/10 §1: an Observation may state the patient's own numbers,
 *    never a verdict, and never that one thing caused another).
 */

export const CLINICAL_RELATIONSHIP_STATUSES = ["suggested", "confirmed", "dismissed"] as const;
export const CLINICAL_RELATIONSHIP_KINDS = [
  "medicine_for_condition",
  "result_tracks_condition",
  "measurement_tracks_condition",
  "provider_for_condition",
  "provider_for_medicine",
] as const;

export const clinicalRelationshipsQuerySchema = z.object({
  /** Only edges that touch this condition (either end). */
  conditionId: z.string().uuid().optional(),
  /** Only edges that touch this medicine (either end). */
  medicationId: z.string().uuid().optional(),
  status: z.enum(CLINICAL_RELATIONSHIP_STATUSES).optional(),
  kind: z.enum(CLINICAL_RELATIONSHIP_KINDS).optional(),
});
export type ClinicalRelationshipsQuery = z.infer<typeof clinicalRelationshipsQuerySchema>;

/**
 * `?analyteKey=hba1c` (a lab analyte) or `?concept=blood_pressure` (a home
 * measurement) — exactly one. Nothing else is accepted: no baseline length,
 * no offsets, no "compare" flag. The windows are fixed server-side and
 * returned in the response so the screen can state them literally.
 */
export const beforeAfterQuerySchema = z
  .object({
    analyteKey: z.string().trim().min(1).max(60).optional(),
    concept: z.string().trim().min(1).max(60).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.analyteKey && !v.concept) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["analyteKey"], message: "Name an analyte or a measurement concept" });
    }
    if (v.analyteKey && v.concept) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["concept"], message: "Name only one of analyteKey and concept" });
    }
  });
export type BeforeAfterQuery = z.infer<typeof beforeAfterQuerySchema>;
