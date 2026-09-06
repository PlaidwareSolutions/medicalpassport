import type { CanonicalOrganization, OrganizationKind } from "../canonical/organization.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import { CODE_SYSTEMS, MEDPASS_SYSTEMS, type Address, type Identifier, type OrganizationResource } from "./r4.js";

/** HL7 organization-type: every kind we know is a healthcare provider ("prov"); the display carries the kind. */
const KIND_DISPLAY: Record<OrganizationKind, string> = {
  clinic: "Clinic",
  hospital: "Hospital",
  laboratory: "Laboratory",
  pharmacy: "Pharmacy",
  diagnostic_centre: "Diagnostic centre",
  other: "Healthcare Provider",
};

/**
 * Canonical organization → R4 `Organization`. NRCeS requires at least one identifier: the HFR id
 * (type PRN) when verified, else the MedicinePassport row id.
 */
export function organizationToResource(input: CanonicalOrganization, profileUrl: string): OrganizationResource {
  const c = requireProvenanceOf("Organization", input);
  const identifier: Identifier[] = [];
  if (c.hfrId) {
    identifier.push({
      type: { coding: [{ system: CODE_SYSTEMS.identifierType, code: "PRN", display: "Provider number" }] },
      system: CODE_SYSTEMS.hfrId,
      value: c.hfrId,
    });
  }
  if (identifier.length === 0) identifier.push({ system: MEDPASS_SYSTEMS.organization, value: c.id });

  const resource: OrganizationResource = {
    resourceType: "Organization",
    id: c.id,
    meta: { profile: [profileUrl] },
    identifier,
    type: [{ coding: [{ system: CODE_SYSTEMS.organizationType, code: "prov", display: "Healthcare Provider" }], text: KIND_DISPLAY[c.kind] }],
    name: c.displayName,
  };
  const address = addressOf(c);
  if (address) resource.address = [address];
  return resource;
}

function addressOf(c: CanonicalOrganization): Address | null {
  if (!c.addressText && !c.city && !c.state && !c.pincode) return null;
  const address: Address = {};
  if (c.addressText) address.text = c.addressText;
  if (c.city) address.city = c.city;
  if (c.state) address.state = c.state;
  if (c.pincode) address.postalCode = c.pincode;
  address.country = "IN";
  return address;
}
