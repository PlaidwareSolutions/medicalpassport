import type { CanonicalPractitioner } from "../canonical/practitioner.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import { CODE_SYSTEMS, MEDPASS_SYSTEMS, type Identifier, type PractitionerResource } from "./r4.js";

/**
 * Canonical practitioner → R4 `Practitioner`. NRCeS requires at least one identifier: the HPR id
 * when verified, else the council registration number, else the MedicinePassport row id.
 */
export function practitionerToResource(input: CanonicalPractitioner, profileUrl: string): PractitionerResource {
  const c = requireProvenanceOf("Practitioner", input);
  const identifier: Identifier[] = [];
  if (c.hprId) {
    identifier.push({
      type: { coding: [{ system: CODE_SYSTEMS.identifierType, code: "MD", display: "Medical License number" }] },
      system: CODE_SYSTEMS.hprId,
      value: c.hprId,
    });
  }
  if (c.registrationNumber) {
    const reg: Identifier = {
      type: { coding: [{ system: CODE_SYSTEMS.identifierType, code: "MD", display: "Medical License number" }] },
      value: c.registrationNumber,
    };
    if (c.registrationCouncil) reg.assigner = { display: c.registrationCouncil };
    identifier.push(reg);
  }
  if (identifier.length === 0) identifier.push({ system: MEDPASS_SYSTEMS.practitioner, value: c.id });

  const resource: PractitionerResource = {
    resourceType: "Practitioner",
    id: c.id,
    meta: { profile: [profileUrl] },
    identifier,
    name: [{ text: c.displayName }],
  };
  if (c.speciality) resource.qualification = [{ code: { text: c.speciality } }];
  return resource;
}
