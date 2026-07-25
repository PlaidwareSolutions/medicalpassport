import { z } from "zod";
import { CLINICAL_CONTENT_KINDS } from "@medpass/domain";

/**
 * Manual authoring by a clinical reviewer, for (ingredient, kind) or
 * (product, kind) pairs openFDA had no reliable match for — exactly one of
 * ingredientId/productId, mirroring ClinicalContent's own DB-level
 * invariant (a CHECK constraint enforces this at the schema layer too).
 */
export const proposeContentChangeSchema = z
  .object({
    ingredientId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    kind: z.enum(CLINICAL_CONTENT_KINDS),
    body: z.string().trim().min(1).max(4000),
    sourceUrl: z.string().url().optional(),
  })
  .refine((v) => Boolean(v.ingredientId) !== Boolean(v.productId), {
    message: "Exactly one of ingredientId or productId is required",
    path: ["ingredientId"],
  });
export type ProposeContentChangeInput = z.infer<typeof proposeContentChangeSchema>;

export const decideContentChangeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500).optional(),
});
export type DecideContentChangeInput = z.infer<typeof decideContentChangeSchema>;

/** English ("en") is the version's own body — only the other 3 supported locales are ever translated. */
export const proposeContentTranslationSchema = z.object({
  locale: z.enum(["hi", "te", "ur"]),
  body: z.string().trim().min(1).max(4000),
});
export type ProposeContentTranslationInput = z.infer<typeof proposeContentTranslationSchema>;

export const decideContentTranslationSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  rejectionReason: z.string().trim().max(500).optional(),
});
export type DecideContentTranslationInput = z.infer<typeof decideContentTranslationSchema>;
