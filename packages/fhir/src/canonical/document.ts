import type { CanonicalPatientRef } from "./patient-ref.js";
import type { CanonicalProvenance } from "./provenance.js";

/** V1 `DocumentKind` plus the V2 additions (docs_v2/04 §7.2); mirrors `@medpass/terminology` document types. */
export const DOCUMENT_KINDS = [
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
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = ["uploaded", "verified", "processing", "processed", "failed", "deleted"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface CanonicalDocumentPage {
  pageNumber: number;
  contentType: string;
  /** Opaque `StoredObject` id — exported as `urn:medicinepassport:stored-object:<id>`, never a URL. */
  storedObjectId: string;
  sizeBytes: number | null;
  /** Hex sha-256 of the bytes when known (exported base64 in `Attachment.hash`). */
  sha256Hex: string | null;
}

/** docs_v2/08 §6 #15: `PatientDocument` + pages → `DocumentReference`. */
export interface CanonicalDocumentReference {
  id: string;
  patient: CanonicalPatientRef;
  kind: DocumentKind;
  title: string | null;
  /** `YYYY-MM-DD`. */
  documentDate: string | null;
  status: DocumentStatus;
  pages: CanonicalDocumentPage[];
  prescriptionId: string | null;
  diagnosticReportId: string | null;
  encounterId: string | null;
  provenance: CanonicalProvenance | null;
}
