import { z } from "zod";
import { DOSE_UNITS, FOOD_INSTRUCTIONS, FREQUENCY_CODES } from "@medpass/domain";

/**
 * Documents V2 (docs_v2/05 §5, docs_v2/04 §7): a multi-page `PatientDocument`
 * with a page-by-page upload flow, a classification the user always outranks,
 * and typed extraction candidates that only ever become clinical rows through
 * an explicit confirmation.
 *
 * V1's single-object `authorize-upload` contract in ./documents.ts is
 * untouched and keeps serving its own endpoints until the V2.5 sunset
 * (docs_v2/05 §15).
 */

/** Every `DocumentKind` the database accepts — V1's 8 values plus the V2 additions (docs_v2/04 §7.2). */
export const DOCUMENT_KINDS_V2 = [
  "prescription",
  "strip",
  "box",
  "bottle",
  "discharge_summary",
  "lab_report",
  "scan_report",
  "other",
  "laboratory_report",
  "imaging_report",
  "consultation_note",
  "vaccination_record",
  "referral",
  "insurance",
  "invoice",
  "imaging_film",
] as const;
export type DocumentKindV2 = (typeof DOCUMENT_KINDS_V2)[number];

export const DOCUMENT_SOURCE_CHANNELS = [
  "camera",
  "gallery",
  "file",
  "share_target",
  "provider_import",
  "abdm",
  "email_intake",
] as const;
export type DocumentSourceChannelInput = (typeof DOCUMENT_SOURCE_CHANNELS)[number];

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * How many pages one document may hold. A capture flow that runs away (a
 * stuck camera shutter, a retrying client) would otherwise mint unbounded
 * presigned uploads against the profile's storage quota.
 */
export const MAX_DOCUMENT_PAGES = 30;

/** One page's declared file, exactly as V1 declares its single object. */
export const documentPageUploadSchema = z.object({
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  sizeBytes: z.coerce.number().int().positive().max(MAX_PDF_BYTES, "File is too large"),
});
export type DocumentPageUploadInput = z.infer<typeof documentPageUploadSchema>;

/** The clinical parents a document may hang off (docs_v2/04 §7.2). */
const linkFields = {
  prescriptionId: z.string().uuid().nullable().optional(),
  diagnosticReportId: z.string().uuid().nullable().optional(),
  encounterId: z.string().uuid().nullable().optional(),
  immunizationId: z.string().uuid().nullable().optional(),
};

/**
 * At most one *clinical* parent; `encounterId` may co-exist with any of them
 * because an encounter is the visit the parent happened at, not a rival owner
 * (docs_v2/04 §7.2 check constraint).
 */
function refineSingleParent(
  value: { prescriptionId?: string | null; diagnosticReportId?: string | null; immunizationId?: string | null },
  ctx: z.RefinementCtx,
): void {
  const parents = [value.prescriptionId, value.diagnosticReportId, value.immunizationId].filter(
    (v) => v !== null && v !== undefined,
  );
  if (parents.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["prescriptionId"],
      message: "A document can belong to only one record",
    });
  }
}

export const createDocumentV2Schema = z
  .object({
    kind: z.enum(DOCUMENT_KINDS_V2).optional(),
    title: z.string().trim().min(1).max(160).optional(),
    /** The date printed on the document, distinct from when it was uploaded. */
    documentDate: z.coerce.date().optional(),
    sourceChannel: z.enum(DOCUMENT_SOURCE_CHANNELS).default("file"),
    ...linkFields,
    /** One upload authorization is returned per entry, in order, as pages 1..N. */
    pages: z.array(documentPageUploadSchema).min(1).max(MAX_DOCUMENT_PAGES),
  })
  .superRefine(refineSingleParent);
export type CreateDocumentV2Input = z.infer<typeof createDocumentV2Schema>;

export const authorizeDocumentPagesSchema = z.object({
  pages: z.array(documentPageUploadSchema).min(1).max(MAX_DOCUMENT_PAGES),
});
export type AuthorizeDocumentPagesInput = z.infer<typeof authorizeDocumentPagesSchema>;

/**
 * The patient's own correction of what this document is (docs_v2/09 §4: "the
 * patient always confirms or overrides the kind"). Anything set here wins over
 * the classifier permanently — `classifiedBy` becomes `user` and no later
 * classification run may move `kind` again.
 */
export const updateDocumentV2Schema = z
  .object({
    kind: z.enum(DOCUMENT_KINDS_V2).optional(),
    title: z.string().trim().min(1).max(160).nullable().optional(),
    documentDate: z.coerce.date().nullable().optional(),
    ...linkFields,
  })
  .superRefine((value, ctx) => {
    refineSingleParent(value, ctx);
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "Nothing to change" });
    }
  });
export type UpdateDocumentV2Input = z.infer<typeof updateDocumentV2Schema>;

export const documentListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  kind: z.enum(DOCUMENT_KINDS_V2).optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

/**
 * Dose is never OCR-derived (docs_v2/09 §1 rule 4, hazard H-02): starting a
 * medicine from a candidate always carries a dose the person typed, exactly
 * as V1's `createMedicationFromExtractionSchema` does.
 */
export const materializeMedicationSchema = z.object({
  doseQuantity: z.coerce.number().positive().max(100),
  doseUnit: z.enum(DOSE_UNITS),
  /** Overrides the extracted frequency; required when the page carried none. */
  frequencyCode: z.enum(FREQUENCY_CODES).optional(),
  pattern: z
    .string()
    .regex(/^\d(\.\d)?-\d(\.\d)?-\d(\.\d)?$/)
    .optional(),
  foodInstruction: z.enum(FOOD_INSTRUCTIONS).optional(),
  isPrn: z.boolean().default(false),
  startDate: z.coerce.date().optional(),
  patientReason: z.string().trim().max(500).optional(),
});
export type MaterializeMedicationInput = z.infer<typeof materializeMedicationSchema>;

/**
 * `correctedValue` is whatever the target's own schema accepts
 * (`valueSchemaFor(entity, field)` in @medpass/document-intelligence) — it is
 * deliberately untyped here so one endpoint serves every target, and is
 * validated against the catalogue inside the service before anything is
 * written.
 */
export const confirmDocumentCandidateSchema = z.object({
  correctedValue: z.unknown().optional(),
  medication: materializeMedicationSchema.optional(),
});
export type ConfirmDocumentCandidateInput = z.infer<typeof confirmDocumentCandidateSchema>;

export const rejectDocumentCandidateSchema = z.object({}).optional();

/**
 * Batch confirmation of a whole extraction (docs_v2/05 §5
 * `extractions/:id/materialize`): the listed candidates are confirmed and
 * materialized in one transaction, so a half-written prescription is never
 * left behind.
 */
export const materializeExtractionSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1).max(200),
  medication: materializeMedicationSchema.optional(),
});
export type MaterializeExtractionInput = z.infer<typeof materializeExtractionSchema>;

export function maxBytesForPage(contentType: string): number {
  return contentType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
}
