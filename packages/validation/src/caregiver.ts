import { z } from "zod";
import { CAREGIVER_SCOPES } from "@medpass/domain";
import { phoneSchema } from "./auth.js";

export const inviteCaregiverSchema = z.object({
  phone: phoneSchema,
  scopes: z.array(z.enum(CAREGIVER_SCOPES)).min(1),
  relationship: z.enum(["parent", "child", "spouse", "sibling", "other"]).default("other"),
  /** Distinguishes this caregiver from another with the same relationship (e.g. two "child" caregivers). */
  label: z.string().trim().min(1).max(80).optional(),
  /** Optional time bound (docs/02 consent principles). */
  expiresAt: z.coerce.date().optional(),
});
export type InviteCaregiverInput = z.infer<typeof inviteCaregiverSchema>;

export const updateCaregiverScopesSchema = z.object({
  scopes: z.array(z.enum(CAREGIVER_SCOPES)).min(1),
  label: z.string().trim().min(1).max(80).optional(),
});

export const acceptInviteSchema = z.object({
  invitationId: z.string().uuid(),
});
