import { z } from "zod";
import { MEDICAL_REPORT_KINDS } from "@medpass/domain";

/**
 * A diagnostic test report the patient keeps a copy of (docs/07 screen 44).
 * Only the kind is required: a patient who can't read the report should still
 * be able to file the photo and fill the rest in later — the same reasoning
 * that made every prescription field optional.
 */
export const createReportSchema = z.object({
  kind: z.enum(MEDICAL_REPORT_KINDS),
  /** Names the specific test — mainly for `other` ("Vitamin D panel"). */
  label: z.string().trim().max(120).optional(),
  facilityName: z.string().trim().max(120).optional(),
  practitionerName: z.string().trim().max(120).optional(),
  testedAt: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;
