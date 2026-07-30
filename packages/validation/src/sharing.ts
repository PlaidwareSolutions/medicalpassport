import { z } from "zod";

export const shareSectionsSchema = z.object({
  medications: z.boolean().optional(),
  allergies: z.boolean().optional(),
  conditions: z.boolean().optional(),
  recentChanges: z.boolean().optional(),
  concerns: z.boolean().optional(),
  glucoseReadings: z.boolean().optional(),
  checkups: z.boolean().optional(),
  prescriptions: z.boolean().optional(),
});

export const createShareSchema = z.object({
  sections: shareSectionsSchema.default({}),
  expiresInHours: z.coerce.number().int().min(1).max(30 * 24).default(24),
  kind: z.enum(["link", "qr"]).default("link"),
});
export type CreateShareInput = z.infer<typeof createShareSchema>;

/** Query-string booleans arrive as "true"/"false" strings — absent or "true" means included, only literal "false" excludes it. */
const sectionQueryFlag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v !== "false");

export const visitSummaryTextQuerySchema = z.object({
  medications: sectionQueryFlag,
  allergies: sectionQueryFlag,
  conditions: sectionQueryFlag,
  recentChanges: sectionQueryFlag,
  concerns: sectionQueryFlag,
  glucoseReadings: sectionQueryFlag,
  checkups: sectionQueryFlag,
  prescriptions: sectionQueryFlag,
});
export type VisitSummaryTextQuery = z.infer<typeof visitSummaryTextQuerySchema>;
