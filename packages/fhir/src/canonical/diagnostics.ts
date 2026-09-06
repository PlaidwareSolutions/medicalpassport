import type { CanonicalPatientRef } from "./patient-ref.js";
import type { CanonicalProvenance } from "./provenance.js";

export const DIAGNOSTIC_REPORT_KINDS = [
  "laboratory",
  "imaging",
  "ecg",
  "echo",
  "pathology",
  "microbiology",
  "genetics",
  "other",
] as const;
export type DiagnosticReportKind = (typeof DIAGNOSTIC_REPORT_KINDS)[number];

export const IMAGING_MODALITIES = ["xray", "ct", "mri", "ultrasound", "mammography", "pet", "nuclear", "other"] as const;
export type ImagingModality = (typeof IMAGING_MODALITIES)[number];

export const DIAGNOSTIC_REPORT_STATUSES = ["registered", "partial", "final", "amended", "cancelled"] as const;
export type DiagnosticReportStatus = (typeof DIAGNOSTIC_REPORT_STATUSES)[number];

export const OBSERVATION_INTERPRETATIONS = ["normal", "high", "low", "critical_high", "critical_low", "abnormal"] as const;
export type ObservationInterpretation = (typeof OBSERVATION_INTERPRETATIONS)[number];

/** docs_v2/08 §6 #5 / #7: `DiagnosticReport` (lab or imaging). */
export interface CanonicalDiagnosticReport {
  id: string;
  patient: CanonicalPatientRef;
  kind: DiagnosticReportKind;
  title: string;
  category: string | null;
  status: DiagnosticReportStatus;
  /** ISO instants / dates as stored. */
  specimenCollectedAt: string | null;
  reportedAt: string | null;
  /** `YYYY-MM-DD`. */
  testedAt: string | null;
  organizationId: string | null;
  facilityNameText: string | null;
  orderingPractitionerId: string | null;
  reportingPractitionerId: string | null;
  modality: ImagingModality | null;
  bodySite: string | null;
  impressionText: string | null;
  findingsText: string | null;
  conclusionText: string | null;
  encounterId: string | null;
  /** Ids of the current (non-superseded) `DiagnosticResult` rows, in sequence order. */
  resultIds: string[];
  /** Ids of `PatientDocument` rows attached to this report (exported as `DocumentReference`). */
  documentIds: string[];
  provenance: CanonicalProvenance | null;
}

/**
 * docs_v2/08 §6 #6: one `DiagnosticResult`. `analyteKey` is resolved to LOINC + UCUM by the
 * serializer through `@medpass/terminology`; an unmapped key is exported with the local analyte
 * CodeSystem plus text and reported as a warning (never dropped, never guessed).
 */
export interface CanonicalLabObservation {
  id: string;
  patient: CanonicalPatientRef;
  diagnosticReportId: string;
  analyteKey: string;
  analyteLabelText: string | null;
  /** LOINC code stored on the row (lab-imported), used when the vocabulary has none. */
  loincCode: string | null;
  enteredValueText: string;
  /** Decimal as a string, in `unit`. */
  valueNumeric: string | null;
  valueText: string | null;
  comparator: "<" | "<=" | ">" | ">=" | null;
  /** UCUM code the value is stored in, or null when it could not be brought to the canonical unit. */
  unit: string | null;
  enteredUnit: string | null;
  referenceLow: string | null;
  referenceHigh: string | null;
  referenceText: string | null;
  /** Only ever the lab's own flag (docs_v2/04 §6.3). */
  interpretation: ObservationInterpretation | null;
  specimenType: string | null;
  /** When the specimen was taken / the test was done, from the parent report. */
  effectiveAt: string | null;
  provenance: CanonicalProvenance | null;
}
