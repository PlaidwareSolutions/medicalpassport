import { z } from "zod";
import { SUPPORTED_LOCALES } from "@medpass/domain";

const currentYear = new Date().getFullYear();

const yearOfBirthField = z.coerce
  .number()
  .int()
  .min(currentYear - 120)
  .max(currentYear);

export const createProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  yearOfBirth: yearOfBirthField.optional(),
  sex: z.enum(["female", "male", "other", "undisclosed"]).optional(),
  preferredLocale: z.enum(SUPPORTED_LOCALES).default("en"),
});
export type CreateProfileInput = z.infer<typeof createProfileSchema>;

/**
 * The account holder's own ("self") profile. Year of birth is REQUIRED here
 * (unlike dependents) so the server can apply the children V1 age gate — a
 * person under 18 may not run their own adult account. See
 * docs/landing-page/children-guardian-remediation-design.md.
 */
export const createSelfProfileSchema = createProfileSchema.extend({
  yearOfBirth: yearOfBirthField,
});
export type CreateSelfProfileInput = z.infer<typeof createSelfProfileSchema>;

export const updateProfileSchema = createProfileSchema.partial().extend({
  rowVersion: z.number().int().nonnegative(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const createDependentSchema = createProfileSchema.extend({
  relationship: z.enum(["parent", "child", "spouse", "sibling", "other"]),
  /**
   * Parent/lawful-guardian attestation. Required by the server when the
   * dependent is a child (relationship "child", or a year of birth that
   * indicates under 18). Optional in the schema; the controller enforces it
   * conditionally so an adult dependent (e.g. an elderly parent) is unaffected.
   */
  guardianAttestation: z.boolean().optional(),
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
