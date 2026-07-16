import { z } from "zod";

export const createShareSchema = z.object({
  sections: z
    .object({
      medications: z.boolean().optional(),
      allergies: z.boolean().optional(),
      conditions: z.boolean().optional(),
      recentChanges: z.boolean().optional(),
      concerns: z.boolean().optional(),
    })
    .default({}),
  expiresInHours: z.coerce.number().int().min(1).max(30 * 24).default(24),
  kind: z.enum(["link", "qr"]).default("link"),
});
export type CreateShareInput = z.infer<typeof createShareSchema>;
