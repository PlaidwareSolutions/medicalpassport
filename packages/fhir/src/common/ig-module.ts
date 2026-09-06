import type { CanonicalAllergy, CanonicalAllergyCandidate } from "../canonical/allergy.js";
import type { CanonicalProvenance } from "../canonical/provenance.js";
import type { SerializeContext } from "./context.js";
import type { AllergyIntoleranceResource, ProvenanceResource, Reference } from "./r4.js";

/** Resource types this package knows how to profile-check. */
export type ProfiledResourceType = "AllergyIntolerance" | "Provenance";

/**
 * The API every `src/ig/<version>/` folder exposes. `version-mapper.ts` selects one;
 * callers outside this package never import a folder directly (docs_v2/08 section 2).
 */
export interface IgModule {
  readonly version: string;
  readonly fhirVersion: "4.0.1";
  readonly label: string;
  /** Profile canonical URL per resource type produced by this folder. */
  readonly profiles: Readonly<Record<ProfiledResourceType, string>>;
  serializeAllergyIntolerance(canonical: CanonicalAllergy, ctx?: SerializeContext): AllergyIntoleranceResource;
  parseAllergyIntolerance(resource: AllergyIntoleranceResource): CanonicalAllergyCandidate;
  serializeProvenance(canonical: CanonicalProvenance, targetRef: Reference, ctx?: SerializeContext): ProvenanceResource;
}
