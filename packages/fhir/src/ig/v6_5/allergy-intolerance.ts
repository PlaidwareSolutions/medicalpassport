import type { CanonicalAllergy, CanonicalAllergyCandidate } from "../../canonical/allergy.js";
import { allergyToResource, resourceToAllergy } from "../../common/allergy-codec.js";
import type { SerializeContext } from "../../common/context.js";
import type { AllergyIntoleranceResource } from "../../common/r4.js";
import { PROFILES } from "./profiles.js";

/** Canonical `PatientAllergy` -> NRCeS v6.5 `AllergyIntolerance`. Throws `ProvenanceMissingError` without provenance. */
export function serializeAllergyIntolerance(
  canonical: CanonicalAllergy,
  _ctx: SerializeContext = {},
): AllergyIntoleranceResource {
  return allergyToResource(canonical, PROFILES.AllergyIntolerance);
}

/** NRCeS v6.5 `AllergyIntolerance` -> canonical candidate (provenance stamped by the importer). */
export function parseAllergyIntolerance(resource: AllergyIntoleranceResource): CanonicalAllergyCandidate {
  return resourceToAllergy(resource);
}
