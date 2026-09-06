/** Options every per-version serializer accepts. The IG version itself is fixed by the folder. */
export interface SerializeContext {
  /** Software version stamped on the Provenance software agent (e.g. `api@1.4.2`). */
  softwareVersion?: string;
}

export const DEFAULT_SOFTWARE_VERSION = "medicinepassport-fhir@0.1.0";
