import { z } from "zod";
import { ORGANIZATION_KINDS } from "@medpass/domain";
import { phoneSchema } from "./auth.js";

/**
 * Patient-scoped facilities (docs_v2/04 §3.1): "Apollo Clinic, Jubilee
 * Hills". `hfrId` and `verification` are never client-settable — they come
 * from ABDM verification only.
 */
const organizationFields = {
  kind: z.enum(ORGANIZATION_KINDS).default("other"),
  displayName: z.string().trim().min(1).max(160),
  addressText: z.string().trim().min(1).max(500).nullable().optional(),
  city: z.string().trim().min(1).max(100).nullable().optional(),
  state: z.string().trim().min(1).max(100).nullable().optional(),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit PIN code").nullable().optional(),
  /** E.164; stored encrypted at rest. */
  phone: phoneSchema.nullable().optional(),
};
export const createOrganizationSchema = z.object(organizationFields);
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    ...organizationFields,
    kind: z.enum(ORGANIZATION_KINDS).optional(),
    displayName: organizationFields.displayName.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const mergeOrganizationSchema = z.object({
  /** The surviving record — everything linked to :id is repointed to it. */
  intoId: z.string().uuid(),
});
export type MergeOrganizationInput = z.infer<typeof mergeOrganizationSchema>;
