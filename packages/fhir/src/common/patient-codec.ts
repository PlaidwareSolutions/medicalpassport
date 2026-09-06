import type { CanonicalPatient } from "../canonical/patient.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import { CODE_SYSTEMS, type Identifier, type PatientResource } from "./r4.js";

/**
 * Canonical patient → R4 `Patient`. Identifiers: ABHA number (type MR, as the NRCeS examples
 * do) and ABHA address, each only when present. Year of birth becomes a partial `birthDate`.
 */
export function patientToResource(input: CanonicalPatient, profileUrl: string): PatientResource {
  const c = requireProvenanceOf("PatientProfile", input);
  const identifier: Identifier[] = [];
  if (c.abhaNumber) {
    identifier.push({
      type: { coding: [{ system: CODE_SYSTEMS.identifierType, code: "MR", display: "Medical record number" }] },
      system: CODE_SYSTEMS.abhaNumber,
      value: c.abhaNumber,
    });
  }
  if (c.abhaAddress) {
    identifier.push({ system: CODE_SYSTEMS.abhaAddress, value: c.abhaAddress });
  }
  const resource: PatientResource = {
    resourceType: "Patient",
    id: c.id,
    meta: { profile: [profileUrl] },
    name: [{ text: c.displayName }],
  };
  if (identifier.length > 0) resource.identifier = identifier;
  if (c.sex) resource.gender = c.sex;
  if (c.yearOfBirth) resource.birthDate = String(c.yearOfBirth);
  return resource;
}
