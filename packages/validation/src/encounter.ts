import { z } from "zod";
import { ENCOUNTER_KINDS } from "@medpass/domain";

/**
 * One visit/admission (docs_v2/04 §3.3). Optional in the V2.0 UI — a patient
 * files an encounter to tie a prescription and a few reports to one doctor
 * visit; nothing else requires it. Provenance is never client-supplied
 * (ADR-V2-002): the service stamps it from the authenticated actor.
 */
const encounterFields = {
  kind: z.enum(ENCOUNTER_KINDS),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  practitionerId: z.string().uuid().nullable().optional(),
  reasonText: z.string().trim().max(500).nullable().optional(),
  diagnosisText: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
};

function checkDates(v: { startedAt?: Date; endedAt?: Date | null }, ctx: z.RefinementCtx): void {
  if (v.startedAt && v.endedAt && v.endedAt < v.startedAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endedAt"], message: "End is before start" });
  }
}

export const encounterSchema = z.object(encounterFields).superRefine(checkDates);
export type EncounterInput = z.infer<typeof encounterSchema>;

/** PATCH body: every field optional; `rowVersion` (when sent) guards against a concurrent edit. */
export const updateEncounterSchema = z
  .object({ ...encounterFields, rowVersion: z.number().int().nonnegative().optional() })
  .partial()
  .superRefine(checkDates);
export type UpdateEncounterInput = z.infer<typeof updateEncounterSchema>;
