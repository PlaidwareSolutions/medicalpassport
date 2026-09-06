import { z } from "zod";
import { ORGANIZATION_KINDS } from "@medpass/domain";

/**
 * Provider directory administration (docs_v2/14 §3, Phase 1 WP P1-6):
 * global Organization / Practitioner entries, HFR/HPR verification and
 * merges, gated by the provider_admin duty. Global entries have no phone
 * — the encrypted phone field exists for patient-entered facilities only.
 */
const adminOrganizationFields = {
  kind: z.enum(ORGANIZATION_KINDS).default("other"),
  displayName: z.string().trim().min(1).max(160),
  addressText: z.string().trim().min(1).max(500).nullable().optional(),
  city: z.string().trim().min(1).max(100).nullable().optional(),
  state: z.string().trim().min(1).max(100).nullable().optional(),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit PIN code").nullable().optional(),
};
export const adminCreateOrganizationSchema = z.object(adminOrganizationFields);
export type AdminCreateOrganizationInput = z.infer<typeof adminCreateOrganizationSchema>;

export const adminUpdateOrganizationSchema = z
  .object({
    ...adminOrganizationFields,
    kind: z.enum(ORGANIZATION_KINDS).optional(),
    displayName: adminOrganizationFields.displayName.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type AdminUpdateOrganizationInput = z.infer<typeof adminUpdateOrganizationSchema>;

const cursorFields = {
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
};

export const ADMIN_DIRECTORY_SCOPES = ["global", "patient", "all"] as const;
export type AdminDirectoryScope = (typeof ADMIN_DIRECTORY_SCOPES)[number];

export const adminOrganizationsQuerySchema = z.object({
  /** Matches global entries' display name only — patient-entered names are never searchable. */
  q: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(ORGANIZATION_KINDS).optional(),
  scope: z.enum(ADMIN_DIRECTORY_SCOPES).default("global"),
  ...cursorFields,
});
export type AdminOrganizationsQuery = z.infer<typeof adminOrganizationsQuerySchema>;

export const adminPractitionersQuerySchema = z.object({
  /** Matches global entries' display name / registration number only. */
  q: z.string().trim().min(1).max(160).optional(),
  scope: z.enum(ADMIN_DIRECTORY_SCOPES).default("all"),
  ...cursorFields,
});
export type AdminPractitionersQuery = z.infer<typeof adminPractitionersQuerySchema>;

/** ABDM Health Facility Registry id — alphanumeric with dots/dashes, as issued. */
export const adminVerifyOrganizationSchema = z.object({
  hfrId: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9.\-]+$/, "Enter the HFR id as issued"),
});
export type AdminVerifyOrganizationInput = z.infer<typeof adminVerifyOrganizationSchema>;

/** ABDM Health Professional Registry id, optionally with the council registration it was matched to. */
export const adminVerifyPractitionerSchema = z.object({
  hprId: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9.\-@]+$/, "Enter the HPR id as issued"),
  registrationNumber: z.string().trim().min(1).max(60).optional(),
  registrationCouncil: z.string().trim().min(1).max(120).optional(),
});
export type AdminVerifyPractitionerInput = z.infer<typeof adminVerifyPractitionerSchema>;
