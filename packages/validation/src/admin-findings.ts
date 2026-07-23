import { z } from "zod";

export const adminFindingsSearchSchema = z.object({
  status: z.enum(["open", "acknowledged", "reviewed_with_professional", "resolved"]).optional(),
  severity: z.enum(["info", "low", "moderate", "high"]).optional(),
  category: z.string().max(80).optional(),
  ruleKey: z.string().max(120).optional(),
  patientProfileId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type AdminFindingsSearchInput = z.infer<typeof adminFindingsSearchSchema>;
