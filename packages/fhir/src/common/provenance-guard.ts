import type { CanonicalProvenance } from "../canonical/provenance.js";
import { ProvenanceMissingError } from "../errors.js";

interface WithProvenance {
  id: string;
  provenance: CanonicalProvenance | null;
}

/**
 * Every serializer's first line (ADR-V2-002): a row without a usable provenance block never
 * becomes a resource. `entityType` is the canonical entity name reported in the error.
 */
export function requireProvenanceOf<T extends WithProvenance>(
  entityType: string,
  canonical: T,
): T & { provenance: CanonicalProvenance } {
  const p = canonical.provenance;
  if (!p || typeof p !== "object" || !p.source || !p.verification || !p.recordedAt) {
    throw new ProvenanceMissingError(entityType, canonical.id);
  }
  return { ...canonical, provenance: p };
}
