import { z } from "zod";
import { CONSENT_TYPES } from "@medpass/domain";

export const grantConsentSchema = z.object({
  type: z.enum(CONSENT_TYPES),
  purpose: z.string().trim().min(1).max(500),
  scope: z.record(z.unknown()).optional(),
  expiresAt: z.coerce.date().optional(),
});
export type GrantConsentInput = z.infer<typeof grantConsentSchema>;
