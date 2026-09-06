import { z } from "zod";
import { phoneSchema } from "./auth.js";
import { isoDateSchema } from "./iso-date.js";

/**
 * V2 Phase 1 clinical profile (docs_v2/04 §10, docs_v2/05 §2):
 * immunizations, procedures, family history, emergency contacts. Provenance
 * is never part of these DTOs — the API rejects any provenance key before
 * parsing (ADR-V2-002) and stamps it server-side.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const uuid = z.string().uuid();
const nonEmpty = { message: "Nothing to update" };

const immunizationFields = {
  vaccineText: text(200),
  vaccineCodeSystem: optionalText(100),
  vaccineCode: optionalText(100),
  doseNumber: z.number().int().min(1).max(50).nullable().optional(),
  administeredOn: isoDateSchema,
  organizationId: uuid.nullable().optional(),
  lotNumber: optionalText(100),
  documentId: uuid.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
};
export const createImmunizationSchema = z.object(immunizationFields);
export type CreateImmunizationInput = z.infer<typeof createImmunizationSchema>;
export const updateImmunizationSchema = z
  .object({ ...immunizationFields, vaccineText: immunizationFields.vaccineText.optional(), administeredOn: isoDateSchema.optional() })
  .refine((v) => Object.keys(v).length > 0, nonEmpty);
export type UpdateImmunizationInput = z.infer<typeof updateImmunizationSchema>;

const procedureFields = {
  procedureText: text(200),
  codeSystem: optionalText(100),
  code: optionalText(100),
  performedOn: isoDateSchema,
  organizationId: uuid.nullable().optional(),
  practitionerId: uuid.nullable().optional(),
  encounterId: uuid.nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
};
export const createProcedureSchema = z.object(procedureFields);
export type CreateProcedureInput = z.infer<typeof createProcedureSchema>;
export const updateProcedureSchema = z
  .object({ ...procedureFields, procedureText: procedureFields.procedureText.optional(), performedOn: isoDateSchema.optional() })
  .refine((v) => Object.keys(v).length > 0, nonEmpty);
export type UpdateProcedureInput = z.infer<typeof updateProcedureSchema>;

const familyHistoryFields = {
  /** e.g. mother, father, sibling, grandparent — free text with a picker in the UI. */
  relationship: text(60),
  conditionText: text(200),
  codeSystem: optionalText(100),
  code: optionalText(100),
  notes: z.string().trim().max(1000).nullable().optional(),
};
export const createFamilyHistorySchema = z.object(familyHistoryFields);
export type CreateFamilyHistoryInput = z.infer<typeof createFamilyHistorySchema>;
export const updateFamilyHistorySchema = z
  .object({
    ...familyHistoryFields,
    relationship: familyHistoryFields.relationship.optional(),
    conditionText: familyHistoryFields.conditionText.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, nonEmpty);
export type UpdateFamilyHistoryInput = z.infer<typeof updateFamilyHistorySchema>;

const emergencyContactFields = {
  name: text(120),
  relationship: optionalText(60),
  /** E.164; stored encrypted at rest (docs_v2/11). */
  phone: phoneSchema,
  /** 1 = call first. */
  priority: z.number().int().min(1).max(10).default(1),
};
export const createEmergencyContactSchema = z.object(emergencyContactFields);
export type CreateEmergencyContactInput = z.infer<typeof createEmergencyContactSchema>;
export const updateEmergencyContactSchema = z
  .object({
    ...emergencyContactFields,
    name: emergencyContactFields.name.optional(),
    phone: phoneSchema.optional(),
    priority: z.number().int().min(1).max(10).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, nonEmpty);
export type UpdateEmergencyContactInput = z.infer<typeof updateEmergencyContactSchema>;
