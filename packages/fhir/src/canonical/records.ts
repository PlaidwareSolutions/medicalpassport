import type { CanonicalAllergy } from "./allergy.js";
import type { CanonicalCondition } from "./condition.js";
import type { CanonicalDiagnosticReport, CanonicalLabObservation } from "./diagnostics.js";
import type { CanonicalDocumentReference } from "./document.js";
import type { CanonicalMedication, CanonicalMedicationRequest, CanonicalMedicationStatement } from "./medication.js";
import type { CanonicalOrganization } from "./organization.js";
import type { CanonicalPatient } from "./patient.js";
import type { CanonicalPatientRef } from "./patient-ref.js";
import type { CanonicalPractitioner } from "./practitioner.js";
import type { CanonicalProvenance } from "./provenance.js";
import type { CanonicalVitalObservation } from "./vital.js";

/** docs_v2/04 §3.3 `Prescription` — the prescribing event that a `PrescriptionRecord` documents. */
export interface CanonicalPrescription {
  id: string;
  patient: CanonicalPatientRef;
  /** `YYYY-MM-DD`. */
  prescribedAt: string | null;
  notes: string | null;
  diagnosisText: string | null;
  validUntil: string | null;
  followUpOn: string | null;
  practitionerId: string | null;
  encounterId: string | null;
  provenance: CanonicalProvenance | null;
}

/** docs_v2/08 §6 #1: everything one `PrescriptionRecord` document bundle is composed from. */
export interface CanonicalPrescriptionRecord {
  prescription: CanonicalPrescription;
  patient: CanonicalPatient;
  practitioner: CanonicalPractitioner | null;
  organization: CanonicalOrganization | null;
  items: CanonicalMedicationRequest[];
  /** Catalog products the items reference (by `medicationId`). */
  medications: CanonicalMedication[];
  /** The original scanned prescription(s), attached by opaque reference. */
  documents: CanonicalDocumentReference[];
}

/** docs_v2/08 §6 #5 / #7: everything one `DiagnosticReportRecord` document bundle is composed from. */
export interface CanonicalDiagnosticReportRecord {
  report: CanonicalDiagnosticReport;
  patient: CanonicalPatient;
  organization: CanonicalOrganization | null;
  practitioner: CanonicalPractitioner | null;
  results: CanonicalLabObservation[];
  documents: CanonicalDocumentReference[];
}

/**
 * docs_v2/08 §8: the Indian Patient Summary input (v7.0 only). The serializer keeps only rows the
 * patient has confirmed (`verification` at least `patient_confirmed`); pass everything and let it filter.
 */
export interface CanonicalPatientSummary {
  patient: CanonicalPatient;
  /** Who is producing the summary; `null` means the patient authored it from their own record. */
  author: { practitioner: CanonicalPractitioner | null; organization: CanonicalOrganization | null };
  medications: CanonicalMedicationStatement[];
  /** Catalog products referenced by the statements. */
  catalog: CanonicalMedication[];
  allergies: CanonicalAllergy[];
  conditions: CanonicalCondition[];
  results: CanonicalLabObservation[];
  vitals: CanonicalVitalObservation[];
}
