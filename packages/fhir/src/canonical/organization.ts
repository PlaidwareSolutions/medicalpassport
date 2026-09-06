import type { CanonicalProvenance } from "./provenance.js";

export const ORGANIZATION_KINDS = ["clinic", "hospital", "laboratory", "pharmacy", "diagnostic_centre", "other"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

/** docs_v2/04 §3.1 `Organization`. The HFR id is set only via ABDM verification. */
export interface CanonicalOrganization {
  id: string;
  displayName: string;
  kind: OrganizationKind;
  hfrId: string | null;
  addressText: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  provenance: CanonicalProvenance | null;
}
