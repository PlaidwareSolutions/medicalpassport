/**
 * NRCeS ABDM FHIR IG v7.0.0 — active preview, July 2026 (see IG-VERSIONS.md).
 * Adds the Indian Patient Summary and concept-specific vital-sign profiles.
 * Never imports from `../v6_5` (ADR-V2-003).
 */
import type { ObservationConcept } from "../../canonical/vital.js";
import { VITAL_SIGN_CONCEPTS } from "../../canonical/vital.js";
import type { ProfiledResourceType } from "../../common/ig-module.js";
import { CODE_SYSTEMS } from "../../common/r4.js";

export const IG_VERSION = "7.0" as const;
export const IG_LABEL = "NRCeS ABDM FHIR IG v7.0.0 (preview)";
export const NRCES_BASE = "https://nrces.in/ndhm/fhir/r4";
const R4_BASE = "http://hl7.org/fhir/StructureDefinition";

export const PROFILES: Readonly<Record<ProfiledResourceType, string>> = {
  AllergyIntolerance: `${NRCES_BASE}/StructureDefinition/AllergyIntolerance`,
  /** NRCeS defines no Provenance profile; the base R4 canonical is used. */
  Provenance: `${R4_BASE}/Provenance`,
  Patient: `${NRCES_BASE}/StructureDefinition/Patient`,
  Practitioner: `${NRCES_BASE}/StructureDefinition/Practitioner`,
  Organization: `${NRCES_BASE}/StructureDefinition/Organization`,
  Medication: `${NRCES_BASE}/StructureDefinition/Medication`,
  MedicationRequest: `${NRCES_BASE}/StructureDefinition/MedicationRequest`,
  MedicationStatement: `${NRCES_BASE}/StructureDefinition/MedicationStatement`,
  DiagnosticReport: `${NRCES_BASE}/StructureDefinition/DiagnosticReportLab`,
  Observation: `${R4_BASE}/Observation`,
  Condition: `${NRCES_BASE}/StructureDefinition/Condition`,
  DocumentReference: `${NRCES_BASE}/StructureDefinition/DocumentReference`,
  Composition: `${NRCES_BASE}/StructureDefinition/PrescriptionRecord`,
};

/** v7.0 vital-sign profiles (docs_v2/08 section 6 #9–#12). */
export const VITAL_PROFILES = {
  blood_pressure: `${NRCES_BASE}/StructureDefinition/ObservationBP`,
  body_weight: `${NRCES_BASE}/StructureDefinition/ObservationBodyWeight`,
  heart_rate: `${NRCES_BASE}/StructureDefinition/ObservationHeartRate`,
  spo2: `${NRCES_BASE}/StructureDefinition/ObservationOxygenSat`,
} as const satisfies Partial<Record<ObservationConcept, string>>;

export const EXTRA_PROFILES = {
  diagnosticReportImaging: `${NRCES_BASE}/StructureDefinition/DiagnosticReportImaging`,
  diagnosticReportRecord: `${NRCES_BASE}/StructureDefinition/DiagnosticReportRecord`,
  vitalSigns: CODE_SYSTEMS.vitalSignsProfile,
  /** Provisional canonical for the v7.0 preview IPS composition; re-verify against the published preview (IG-VERSIONS.md). */
  indianPatientSummary: `${NRCES_BASE}/StructureDefinition/IndianPatientSummary`,
} as const;

export const ALTERNATE_PROFILES: Readonly<Partial<Record<ProfiledResourceType, readonly string[]>>> = {
  DiagnosticReport: [EXTRA_PROFILES.diagnosticReportImaging],
  Observation: [EXTRA_PROFILES.vitalSigns, ...Object.values(VITAL_PROFILES)],
  Composition: [EXTRA_PROFILES.diagnosticReportRecord, EXTRA_PROFILES.indianPatientSummary],
};

/** BP / weight / heart rate / SpO2 get their v7 profile; other vital signs stay on the base vital-signs profile. */
export function vitalProfileFor(concept: ObservationConcept): string {
  const specific = (VITAL_PROFILES as Partial<Record<ObservationConcept, string>>)[concept];
  if (specific) return specific;
  return VITAL_SIGN_CONCEPTS.has(concept) ? EXTRA_PROFILES.vitalSigns : PROFILES.Observation;
}
