/** Options every per-version serializer accepts. The IG version itself is fixed by the folder. */
export interface SerializeContext {
  /** Software version stamped on the Provenance software agent (e.g. `api@1.4.2`). */
  softwareVersion?: string;
  /**
   * Document bundles only: `Bundle.id` / `Bundle.identifier.value`. Defaults to the root row's id
   * so fixtures stay deterministic; the API passes a fresh uuid per export.
   */
  bundleId?: string;
  /** Document bundles only: ISO instant for `Bundle.timestamp` and `Composition.date`. Defaults to the root row's `recordedAt`. */
  timestamp?: string;
}

export const DEFAULT_SOFTWARE_VERSION = "medicinepassport-fhir@0.1.0";
