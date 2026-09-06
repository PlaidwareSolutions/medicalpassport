/**
 * NRCeS ABDM FHIR IG v6.5.0 — current published version (see IG-VERSIONS.md).
 * This folder is frozen once a newer folder exists (ADR-V2-003).
 */
export const IG_VERSION = "6.5" as const;
export const IG_LABEL = "NRCeS ABDM FHIR IG v6.5.0";
export const NRCES_BASE = "https://nrces.in/ndhm/fhir/r4";

export const PROFILES = {
  AllergyIntolerance: `${NRCES_BASE}/StructureDefinition/AllergyIntolerance`,
  /** NRCeS defines no Provenance profile; the base R4 canonical is used. */
  Provenance: "http://hl7.org/fhir/StructureDefinition/Provenance",
} as const;
