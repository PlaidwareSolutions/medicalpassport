import type { BundleEntry, BundleResource, ResourceBase } from "./common/r4.js";

export interface CollectionBundleOptions {
  /** Bundle id (FHIR id syntax). */
  id?: string;
  /** ISO-8601 instant; omitted when not supplied so output stays deterministic. */
  timestamp?: string;
}

/**
 * Wraps resources in a `Bundle` of type `collection`. Entries get `fullUrl` as
 * `urn:uuid:<id>` when the resource has an id so intra-bundle references resolve.
 * Document bundles (`PrescriptionRecord` etc.) are a later artifact and get their own builder.
 */
export function buildCollectionBundle<R extends ResourceBase>(
  resources: readonly R[],
  options: CollectionBundleOptions = {},
): BundleResource<R> {
  const entry: BundleEntry<R>[] = resources.map((resource) =>
    resource.id ? { fullUrl: `urn:uuid:${resource.id}`, resource } : { resource },
  );
  const bundle: BundleResource<R> = {
    resourceType: "Bundle",
    type: "collection",
    total: resources.length,
    entry,
  };
  if (options.id) bundle.id = options.id;
  if (options.timestamp) bundle.timestamp = options.timestamp;
  return bundle;
}
