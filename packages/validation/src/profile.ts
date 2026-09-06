import { z } from "zod";
import {
  ALLERGY_CATEGORIES,
  ALLERGY_CRITICALITIES,
  BLOOD_GROUPS,
  CONDITION_CLINICAL_STATUSES,
  isValidTimeZone,
  SUPPORTED_LOCALES,
} from "@medpass/domain";
import { isoDateSchema } from "./iso-date.js";

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
  /** IANA zone, validated against the platform's own ICU tables (docs/16). */
  timezone: z
    .string()
    .refine(isValidTimeZone, { message: "Unknown time zone" })
    .optional(),
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
  /** V2 Phase 1 (docs_v2/04 §10). `null` clears. */
  bloodGroup: z.enum(BLOOD_GROUPS).nullable().optional(),
  /** Last known height in cm; plausibility bound only, never a clinical threshold. */
  heightCm: z.number().min(30).max(250).nullable().optional(),
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

/**
 * V2 Phase 1 (docs_v2/04 §10): the V1 fields stay, the new coded/clinical
 * fields are optional. Provenance is never accepted here — the API rejects
 * any provenance key before parsing (ADR-V2-002).
 */
const allergyFields = {
  label: z.string().trim().min(1).max(200),
  reactionNote: z.string().trim().max(500).nullable().optional(),
  category: z.enum(ALLERGY_CATEGORIES).nullable().optional(),
  criticality: z.enum(ALLERGY_CRITICALITIES).nullable().optional(),
  onsetDate: isoDateSchema.nullable().optional(),
  codeSystem: z.string().trim().min(1).max(100).nullable().optional(),
  code: z.string().trim().min(1).max(100).nullable().optional(),
};

export const allergySchema = z.object({
  ...allergyFields,
  severity: z.enum(["mild", "moderate", "severe", "unknown"]).default("unknown"),
});
export type AllergyInput = z.infer<typeof allergySchema>;

export const updateAllergySchema = z
  .object({
    ...allergyFields,
    label: allergyFields.label.optional(),
    severity: z.enum(["mild", "moderate", "severe", "unknown"]).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateAllergyInput = z.infer<typeof updateAllergySchema>;

const conditionFields = {
  label: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).nullable().optional(),
  clinicalStatus: z.enum(CONDITION_CLINICAL_STATUSES).nullable().optional(),
  onsetDate: isoDateSchema.nullable().optional(),
  abatementDate: isoDateSchema.nullable().optional(),
  codeSystem: z.string().trim().min(1).max(100).nullable().optional(),
  code: z.string().trim().min(1).max(100).nullable().optional(),
  severity: z.string().trim().min(1).max(100).nullable().optional(),
  diagnosedByPractitionerId: z.string().uuid().nullable().optional(),
  encounterId: z.string().uuid().nullable().optional(),
};

const conditionDatesInOrder = (v: { onsetDate?: string | null; abatementDate?: string | null }) =>
  !v.onsetDate || !v.abatementDate || v.abatementDate >= v.onsetDate;

export const conditionSchema = z
  .object(conditionFields)
  .refine(conditionDatesInOrder, { message: "Abatement date cannot be before onset date", path: ["abatementDate"] });
export type ConditionInput = z.infer<typeof conditionSchema>;

export const updateConditionSchema = z
  .object({ ...conditionFields, label: conditionFields.label.optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" })
  .refine(conditionDatesInOrder, { message: "Abatement date cannot be before onset date", path: ["abatementDate"] });
export type UpdateConditionInput = z.infer<typeof updateConditionSchema>;
