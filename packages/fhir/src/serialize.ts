import type { CanonicalAllergy } from "./canonical/allergy.js";
import { requireProvenance } from "./common/allergy-codec.js";
import type { SerializeContext } from "./common/context.js";
import type { AllergyIntoleranceResource, ProvenanceResource } from "./common/r4.js";
import { getIg, type IgVersion } from "./version-mapper.js";

export interface SerializeOptions extends SerializeContext {
  ig: IgVersion;
}

/** Canonical entities the boundary can export today; grows per docs_v2/08 section 6 order. */
export type SerializableEntity = { kind: "AllergyIntolerance"; canonical: CanonicalAllergy };

export interface SerializedEntity<R extends AllergyIntoleranceResource = AllergyIntoleranceResource> {
  resource: R;
  /** Always emitted alongside the resource (docs_v2/08 section 6 #16). */
  provenance: ProvenanceResource;
}

/**
 * The entry point the API uses: `serialize(entity, { ig })`. Produces the clinical resource plus its
 * `Provenance`. Throws `ProvenanceMissingError` when the canonical row lacks its provenance block
 * (fails closed, ADR-V2-002) and `UnsupportedIgVersionError` for an unknown IG.
 */
export function serialize(entity: SerializableEntity, options: SerializeOptions): SerializedEntity {
  const { ig: version, ...ctx } = options;
  const ig = getIg(version);
  switch (entity.kind) {
    case "AllergyIntolerance": {
      const { provenance: block } = requireProvenance(entity.canonical);
      const resource = ig.serializeAllergyIntolerance(entity.canonical, ctx);
      const provenance = ig.serializeProvenance(
        block,
        { reference: `AllergyIntolerance/${resource.id}` },
        ctx,
      );
      return { resource, provenance };
    }
  }
}
