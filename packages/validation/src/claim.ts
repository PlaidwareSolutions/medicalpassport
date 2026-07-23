import { z } from "zod";
import { phoneSchema } from "./auth.js";

export const claimInviteSchema = z.object({
  phone: phoneSchema,
  /** Optional time bound (docs/02 consent principles) — a claim grants
   * more than any single caregiver scope (it bypasses scope checks
   * entirely as the profile's new "self"), so an open-ended invite
   * matters even more here than for a regular caregiver invite. */
  expiresAt: z.coerce.date().optional(),
});
export type ClaimInviteInput = z.infer<typeof claimInviteSchema>;

export const claimProfileSchema = z.object({
  profileId: z.string().uuid(),
});
export type ClaimProfileInput = z.infer<typeof claimProfileSchema>;
