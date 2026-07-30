import { z } from "zod";
import { DOSE_UNITS } from "@medpass/domain";

export const DOCUMENT_KINDS = ["prescription", "strip", "box", "bottle", "discharge_summary", "other"] as const;

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export const authorizeUploadSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS).default("prescription"),
  /** Attaches this upload to a standing prescription record (docs/07 screen
   * 43). Absent for the one-off scan-to-add-a-medicine flow, which needs no
   * prescription record of its own. */
  prescriptionId: z.string().uuid().optional(),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  sizeBytes: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PDF_BYTES, "File is too large"),
});
export type AuthorizeUploadInput = z.infer<typeof authorizeUploadSchema>;

export function maxBytesFor(contentType: string): number {
  return contentType === "application/pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES;
}

export const confirmCandidateSchema = z.object({
  confirmedValue: z.string().trim().min(1).max(200),
});

export const rejectCandidateSchema = z.object({}).optional();

/**
 * Fields OCR cannot responsibly guess (docs/09 §6 — dose amounts are a
 * hazard-critical field) always come from the patient via picker, never
 * from a detected candidate.
 */
export const createMedicationFromExtractionSchema = z.object({
  doseQuantity: z.coerce.number().positive().max(100),
  doseUnit: z.enum(DOSE_UNITS),
  patientReason: z.string().trim().max(500).optional(),
  prescriberName: z.string().trim().max(120).optional(),
  startDate: z.coerce.date().optional(),
  isPrn: z.boolean().default(false),
});
export type CreateMedicationFromExtractionInput = z.infer<typeof createMedicationFromExtractionSchema>;
