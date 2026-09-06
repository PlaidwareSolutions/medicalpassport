import type { CanonicalProvenance } from "./provenance.js";

/** docs_v2/04 §3.2 `Practitioner`. Global directory row; the HPR id is set only via ABDM verification. */
export interface CanonicalPractitioner {
  id: string;
  displayName: string;
  speciality: string | null;
  registrationNumber: string | null;
  registrationCouncil: string | null;
  hprId: string | null;
  organizationId: string | null;
  provenance: CanonicalProvenance | null;
}
