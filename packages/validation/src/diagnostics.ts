import { z } from "zod";
import {
  DIAGNOSTIC_REPORT_KINDS,
  DIAGNOSTIC_REPORT_STATUSES,
  IMAGING_MODALITIES,
  OBSERVATION_INTERPRETATIONS,
  RESULT_COMPARATORS,
} from "@medpass/domain";

/**
 * Diagnostics (docs_v2/04 §6, docs_v2/05 §6) — the V2 replacement for
 * `MedicalReport`/`ReportValue`, covering labs *and* imaging in one shape.
 *
 * `analyteKey` is deliberately a plain string here rather than a `z.enum`:
 * docs_v2/04 §6.3 says the V1 closed vocabulary is "extended by the
 * terminology layer", and @medpass/terminology — not this package — owns
 * that list. The service resolves the key against `getAnalyte()` and
 * returns a 400 for anything unknown, so an unmapped key can never reach
 * the database.
 *
 * `interpretation` is accepted by the schema but refused by the service on
 * any non-provider path (`ERROR_CODES.INTERPRETATION_NOT_CLIENT_SETTABLE`).
 * It is parsed rather than stripped so the refusal is explicit: silently
 * dropping a lab's "critical high" flag is the more dangerous failure.
 */
export const createDiagnosticReportSchema = z.object({
  kind: z.enum(DIAGNOSTIC_REPORT_KINDS).default("laboratory"),
  /** Lab-provided grouping, e.g. "haematology", "biochemistry". */
  category: z.string().trim().max(80).optional(),
  title: z.string().trim().min(1).max(160),
  specimenCollectedAt: z.coerce.date().optional(),
  reportedAt: z.coerce.date().optional(),
  /** The V1 display date, kept: what the patient recognises as "the date on the report". */
  testedAt: z.coerce.date().optional(),
  facilityNameText: z.string().trim().max(120).optional(),
  organizationId: z.string().uuid().nullable().optional(),
  orderingPractitionerName: z.string().trim().max(120).optional(),
  reportingPractitionerName: z.string().trim().max(120).optional(),
  modality: z.enum(IMAGING_MODALITIES).optional(),
  bodySite: z.string().trim().max(120).optional(),
  impressionText: z.string().trim().max(4000).optional(),
  findingsText: z.string().trim().max(8000).optional(),
  conclusionText: z.string().trim().max(4000).optional(),
  status: z.enum(DIAGNOSTIC_REPORT_STATUSES).default("final"),
  encounterId: z.string().uuid().nullable().optional(),
});
export type CreateDiagnosticReportInput = z.infer<typeof createDiagnosticReportSchema>;

/** Every field optional — a report filed off a photo gets completed later. */
export const updateDiagnosticReportSchema = createDiagnosticReportSchema.partial();
export type UpdateDiagnosticReportInput = z.infer<typeof updateDiagnosticReportSchema>;

export const addDiagnosticResultSchema = z
  .object({
    analyteKey: z.string().trim().min(1).max(64),
    /** Required when `analyteKey` is `other`; names what the lab printed. */
    analyteLabelText: z.string().trim().min(1).max(80).optional(),
    /** Exactly as printed — numeric or qualitative ("Negative", "<5.7"). Immutable. */
    enteredValueText: z.string().trim().min(1).max(60),
    /** The unit as printed; converted to the analyte's canonical unit by the service. */
    enteredUnit: z.string().trim().max(30).optional(),
    comparator: z.enum(RESULT_COMPARATORS).optional(),
    referenceLow: z.coerce.number().finite().optional(),
    referenceHigh: z.coerce.number().finite().optional(),
    /** The lab's own printed range — display-only, never compared (docs/02). */
    referenceText: z.string().trim().max(120).optional(),
    /** Only ever the lab's own flag; refused on a patient/caregiver path. */
    interpretation: z.enum(OBSERVATION_INTERPRETATIONS).optional(),
    specimenType: z.string().trim().max(60).optional(),
    sequence: z.number().int().min(1).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.analyteKey === "other" && !v.analyteLabelText) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["analyteLabelText"], message: "Name the test this value is for" });
    }
    if (v.analyteKey !== "other" && v.analyteLabelText) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["analyteLabelText"], message: "Only 'other' values take a custom name" });
    }
    if (v.referenceLow !== undefined && v.referenceHigh !== undefined && v.referenceLow > v.referenceHigh) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceLow"], message: "The low end of the range cannot be above the high end" });
    }
  });
export type AddDiagnosticResultInput = z.infer<typeof addDiagnosticResultSchema>;

/**
 * A correction (docs_v2/04 §6.3, docs_v2/05 §6): never an in-place edit. The
 * service writes a *new* row and points the original at it via
 * `supersededById`, so the value the doctor saw last week is still there.
 * `analyteKey` therefore cannot change — that would be a different test, and
 * the honest action is deleting this row and adding another.
 */
export const correctDiagnosticResultSchema = addDiagnosticResultSchema.innerType()
  .omit({ analyteKey: true, sequence: true })
  .extend({ correctionReason: z.string().trim().max(200).optional() });
export type CorrectDiagnosticResultInput = z.infer<typeof correctDiagnosticResultSchema>;

const isoDateish = z.coerce.date();

export const diagnosticReportsQuerySchema = z.object({
  kind: z.enum(DIAGNOSTIC_REPORT_KINDS).optional(),
  from: isoDateish.optional(),
  to: isoDateish.optional(),
});
export type DiagnosticReportsQuery = z.infer<typeof diagnosticReportsQuerySchema>;

/** `?analyteKey&loinc&from&to` (docs_v2/05 §6). All filters optional. */
export const diagnosticResultsQuerySchema = z.object({
  analyteKey: z.string().trim().min(1).max(64).optional(),
  loinc: z.string().trim().min(1).max(20).optional(),
  from: isoDateish.optional(),
  to: isoDateish.optional(),
});
export type DiagnosticResultsQuery = z.infer<typeof diagnosticResultsQuerySchema>;

/** `?from&to` for one analyte's trend; the analyte itself is a path parameter. */
export const resultTrendQuerySchema = z.object({
  from: isoDateish.optional(),
  to: isoDateish.optional(),
});
export type ResultTrendQuery = z.infer<typeof resultTrendQuerySchema>;
