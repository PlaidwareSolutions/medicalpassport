/**
 * NRCeS ABDM FHIR IG v7.0.0 — active preview, July 2026 (see IG-VERSIONS.md).
 * Adds the Indian Patient Summary and vital-sign profiles; those land here as
 * further artifacts. Never imports from `../v6_5` (ADR-V2-003).
 */
export const IG_VERSION = "7.0" as const;
export const IG_LABEL = "NRCeS ABDM FHIR IG v7.0.0 (preview)";
export const NRCES_BASE = "https://nrces.in/ndhm/fhir/r4";

export const PROFILES = {
  AllergyIntolerance: `${NRCES_BASE}/StructureDefinition/AllergyIntolerance`,
  /** NRCeS defines no Provenance profile; the base R4 canonical is used. */
  Provenance: "http://hl7.org/fhir/StructureDefinition/Provenance",
} as const;
