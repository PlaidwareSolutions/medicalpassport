import { z } from "zod";
import { CAREGIVER_SCOPES } from "@medpass/domain";
import { phoneSchema } from "./auth.js";

export const inviteCaregiverSchema = z.object({
  phone: phoneSchema,
  scopes: z.array(z.enum(CAREGIVER_SCOPES)).min(1),
  relationship: z.enum(["parent", "child", "spouse", "sibling", "other"]).default("other"),
  /** Optional time bound (docs/02 consent principles). */
  expiresAt: z.coerce.date().optional(),
});
export type InviteCaregiverInput = z.infer<typeof inviteCaregiverSchema>;

export const updateCaregiverScopesSchema = z.object({
  scopes: z.array(z.enum(CAREGIVER_SCOPES)).min(1),
});

export const acceptInviteSchema = z.object({
  invitationId: z.string().uuid(),
});
