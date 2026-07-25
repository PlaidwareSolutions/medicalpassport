import { z } from "zod";
import { CLINICAL_CONTENT_KINDS } from "@medpass/domain";

/** Manual authoring by a clinical reviewer, for (ingredient, kind) pairs openFDA had no reliable match for. */
export const proposeContentChangeSchema = z.object({
  ingredientId: z.string().uuid(),
  kind: z.enum(CLINICAL_CONTENT_KINDS),
  body: z.string().trim().min(1).max(4000),
  sourceUrl: z.string().url().optional(),
});
export type ProposeContentChangeInput = z.infer<typeof proposeContentChangeSchema>;

export const decideContentChangeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500).optional(),
});
export type DecideContentChangeInput = z.infer<typeof decideContentChangeSchema>;
