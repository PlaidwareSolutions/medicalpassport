/**
 * NRCeS ABDM FHIR IG v6.5.0 — current published version (see IG-VERSIONS.md).
 * This folder is frozen once a newer folder exists (ADR-V2-003).
 */
import type { ObservationConcept } from "../../canonical/vital.js";
import { VITAL_SIGN_CONCEPTS } from "../../canonical/vital.js";
import type { ProfiledResourceType } from "../../common/ig-module.js";
import { CODE_SYSTEMS } from "../../common/r4.js";

export const IG_VERSION = "6.5" as const;
export const IG_LABEL = "NRCeS ABDM FHIR IG v6.5.0";
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
  /** Primary is the lab profile; imaging reports declare `DiagnosticReportImaging` (ALTERNATE_PROFILES). */
  DiagnosticReport: `${NRCES_BASE}/StructureDefinition/DiagnosticReportLab`,
  /** NRCeS v6.5 has no lab-Observation profile: lab results are base R4; vitals use the R4 vital-signs profile. */
  Observation: `${R4_BASE}/Observation`,
  Condition: `${NRCES_BASE}/StructureDefinition/Condition`,
  DocumentReference: `${NRCES_BASE}/StructureDefinition/DocumentReference`,
  /** Primary is the prescription document; diagnostic report documents declare `DiagnosticReportRecord`. */
  Composition: `${NRCES_BASE}/StructureDefinition/PrescriptionRecord`,
};

export const EXTRA_PROFILES = {
  diagnosticReportImaging: `${NRCES_BASE}/StructureDefinition/DiagnosticReportImaging`,
  diagnosticReportRecord: `${NRCES_BASE}/StructureDefinition/DiagnosticReportRecord`,
  vitalSigns: CODE_SYSTEMS.vitalSignsProfile,
} as const;

export const ALTERNATE_PROFILES: Readonly<Partial<Record<ProfiledResourceType, readonly string[]>>> = {
  DiagnosticReport: [EXTRA_PROFILES.diagnosticReportImaging],
  Observation: [EXTRA_PROFILES.vitalSigns],
  Composition: [EXTRA_PROFILES.diagnosticReportRecord],
};

/** v6.5 has no concept-specific vital-sign profiles: every vital sign is the base R4 vital-signs profile. */
export function vitalProfileFor(concept: ObservationConcept): string {
  return VITAL_SIGN_CONCEPTS.has(concept) ? EXTRA_PROFILES.vitalSigns : PROFILES.Observation;
}
