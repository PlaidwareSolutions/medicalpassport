/**
 * `document-types.v1` — document kinds → LOINC document-type codes (and the
 * ABDM health-information type each kind travels as).
 *
 * Keys are the V1 `DocumentKind` enum (8 values, `packages/database`
 * schema) plus the V2 additions from docs_v2/04 §7.2. A LOINC code is set
 * only where a standard document code exists for that kind; medicine
 * packaging photos (`strip`, `box`, `bottle`), administrative documents
 * (`insurance`, `invoice`) and `other` have none and are intentionally
 * unmapped — they still export as `DocumentReference` with a local code.
 */

export const DOCUMENT_KINDS_V1 = [
  // V1 DocumentKind
  "prescription",
  "strip",
  "box",
  "bottle",
  "discharge_summary",
  "lab_report",
  "scan_report",
  "other",
  // V2 additions (docs_v2/04 §7.2)
  "consultation_note",
  "vaccination_record",
  "referral",
  "insurance",
  "invoice",
  "imaging_film",
] as const;
export type DocumentKindKey = (typeof DOCUMENT_KINDS_V1)[number];

/** ABDM HI types (NDHM HealthInformationType) a document can be packaged under. */
export type AbdmHiType =
  | "Prescription"
  | "DiagnosticReport"
  | "OPConsultation"
  | "DischargeSummary"
  | "ImmunizationRecord"
  | "HealthDocumentRecord"
  | "WellnessRecord";

export interface DocumentTypeEntry {
  readonly key: DocumentKindKey;
  readonly display: string;
  readonly loincCode: string | null;
  readonly loincDisplay: string | null;
  /** The ABDM bundle type this document is carried in; `HealthDocumentRecord` is the generic fallback. */
  readonly abdmHiType: AbdmHiType;
  /** True when the kind has no standard document code by nature (not a review gap). */
  readonly intentionallyUnmapped: boolean;
  readonly reviewNote?: string;
}

export const DOCUMENT_TYPES_V1: readonly DocumentTypeEntry[] = [
  {
    key: "prescription",
    display: "Prescription",
    loincCode: "57833-6",
    loincDisplay: "Prescription for medication",
    abdmHiType: "Prescription",
    intentionallyUnmapped: false,
  },
  {
    key: "strip",
    display: "Medicine strip photo",
    loincCode: null,
    loincDisplay: null,
    abdmHiType: "HealthDocumentRecord",
    intentionallyUnmapped: true,
    reviewNote: "Packaging photo used for medicine identification; not a clinical document type.",
  },
  {
    key: "box",
    display: "Medicine box photo",
    loincCode: null,
    loincDisplay: null,
    abdmHiType: "HealthDocumentRecord",
    intentionallyUnmapped: true,
    reviewNote: "Packaging photo used for medicine identification; not a clinical document type.",
  },
  {
    key: "bottle",
    display: "Medicine bottle photo",
    loincCode: null,
    loincDisplay: null,
    abdmHiType: "HealthDocumentRecord",
    intentionallyUnmapped: true,
    reviewNote: "Packaging photo used for medicine identification; not a clinical document type.",
  },
  {
    key: "discharge_summary",
    display: "Discharge summary",
    loincCode: "18842-5",
    loincDisplay: "Discharge summary",
    abdmHiType: "DischargeSummary",
    intentionallyUnmapped: false,
  },
  {
    key: "lab_report",
    display: "Lab report",
    loincCode: "11502-2",
    loincDisplay: "Laboratory report",
    abdmHiType: "DiagnosticReport",
    intentionallyUnmapped: false,
  },
  {
    key: "scan_report",
    display: "Scan / imaging report",
    loincCode: "18748-4",
    loincDisplay: "Diagnostic imaging study",
    abdmHiType: "DiagnosticReport",
    intentionallyUnmapped: false,
  },
  {
    key: "other",
    display: "Other document",
    loincCode: null,
    loincDisplay: null,
    abdmHiType: "HealthDocumentRecord",
    intentionallyUnmapped: true,
    reviewNote: "Open entry by design.",
  },
  {
    key: "consultation_note",
    display: "Consultation note",
    loincCode: "11488-4",
    loincDisplay: "Consult note",
    abdmHiType: "OPConsultation",
    intentionallyUnmapped: false,
  },
  {
    key: "vaccination_record",
    display: "Vaccination record",
    loincCode: "11369-6",
    loincDisplay: "History of Immunization Narrative",
    abdmHiType: "ImmunizationRecord",
    intentionallyUnmapped: false,
  },
  {
    key: "referral",
    display: "Referral letter",
    loincCode: "57133-1",
    loincDisplay: "Referral note",
    abdmHiType: "OPConsultation",
    intentionallyUnmapped: false,
    reviewNote: "ABDM has no dedicated referral HI type; carried as OPConsultation until NHA guidance says otherwise.",
  },
  {
    key: "insurance",
    display: "Insurance document",
    loincCode: null,
    loincDisplay: null,
    abdmHiType: "HealthDocumentRecord",
    intentionallyUnmapped: true,
    reviewNote: "Administrative document; no clinical document code.",
  },
  {
    key: "invoice",
    display: "Invoice / bill",
    loincCode: null,
    loincDisplay: null,
    abdmHiType: "HealthDocumentRecord",
    intentionallyUnmapped: true,
    reviewNote: "Administrative document; no clinical document code.",
  },
  {
    key: "imaging_film",
    display: "Imaging film / image",
    loincCode: null,
    loincDisplay: null,
    abdmHiType: "DiagnosticReport",
    intentionallyUnmapped: false,
    reviewNote:
      "The image itself, not the report (18748-4 is the report). Candidates are modality-specific LOINC " +
      "radiology codes or a DICOM ImagingStudy reference; reviewer to decide.",
  },
];
