import { z } from "zod";
import { SUPPORTED_LOCALES } from "@medpass/domain";

const currentYear = new Date().getFullYear();

export const createProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  yearOfBirth: z.coerce
    .number()
    .int()
    .min(currentYear - 120)
    .max(currentYear)
    .optional(),
  sex: z.enum(["female", "male", "other", "undisclosed"]).optional(),
  preferredLocale: z.enum(SUPPORTED_LOCALES).default("en"),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export const updateProfileSchema = createProfileSchema.partial().extend({
  rowVersion: z.number().int().nonnegative(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createDependentSchema = createProfileSchema.extend({
  relationship: z.enum(["parent", "child", "spouse", "sibling", "other"]),
});
export type CreateDependentInput = z.infer<typeof createDependentSchema>;

export const allergySchema = z.object({
  label: z.string().trim().min(1).max(200),
  severity: z.enum(["mild", "moderate", "severe", "unknown"]).default("unknown"),
  reactionNote: z.string().trim().max(500).optional(),
});
export type AllergyInput = z.infer<typeof allergySchema>;

export const conditionSchema = z.object({
  label: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).optional(),
});
export type ConditionInput = z.infer<typeof conditionSchema>;
