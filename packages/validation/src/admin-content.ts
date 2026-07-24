import { z } from "zod";

/** Manual authoring by a clinical reviewer, for ingredients openFDA had no reliable match for. */
export const proposeContentChangeSchema = z.object({
  ingredientId: z.string().uuid(),
  kind: z.literal("education"),
  body: z.string().trim().min(1).max(4000),
  sourceUrl: z.string().url().optional(),
});
export type ProposeContentChangeInput = z.infer<typeof proposeContentChangeSchema>;

export const decideContentChangeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500).optional(),
});
export type DecideContentChangeInput = z.infer<typeof decideContentChangeSchema>;
