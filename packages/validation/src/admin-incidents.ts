import { z } from "zod";

export const adminRevokeShareSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type AdminRevokeShareInput = z.infer<typeof adminRevokeShareSchema>;
