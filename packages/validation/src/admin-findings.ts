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

/** `GET admin/rules/quality?from&to` (docs_v2/06 P9-4): the window defaults to the trailing 30 days. */
export const adminRulesQualityQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "from must not be after to", path: ["from"] });
export type AdminRulesQualityQuery = z.infer<typeof adminRulesQualityQuerySchema>;
