import type { CanonicalProvenance } from "../../canonical/provenance.js";
import type { SerializeContext } from "../../common/context.js";
import { provenanceToResource } from "../../common/provenance-codec.js";
import type { ProvenanceResource, Reference } from "../../common/r4.js";
import { IG_VERSION, PROFILES } from "./profiles.js";

/** Provenance block -> R4 `Provenance` targeting `targetRef`, stamped with the v6.5 IG label. */
export function serializeProvenance(
  canonical: CanonicalProvenance,
  targetRef: Reference,
  ctx: SerializeContext = {},
): ProvenanceResource {
  return provenanceToResource(canonical, targetRef, {
    ...ctx,
    igVersion: IG_VERSION,
    profileUrl: PROFILES.Provenance,
  });
}
