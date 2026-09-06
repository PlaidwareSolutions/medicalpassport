import { describe, expect, it } from "vitest";
import { SUPPORTED_IG_VERSIONS, buildCollectionBundle, getIg, serialize, validateResource } from "../src/index.js";
import { CANONICAL_ALLERGY_FIXTURES, clone, loadCanonicalAllergy } from "./helpers.js";

describe.each(SUPPORTED_IG_VERSIONS)("buildCollectionBundle — IG %s", (version) => {
  it("wraps N resources with fullUrl entries and validates", () => {
    const resources = CANONICAL_ALLERGY_FIXTURES.flatMap((name) => {
      const { resource, provenance } = serialize(
        { kind: "AllergyIntolerance", canonical: loadCanonicalAllergy(name) },
        { ig: version },
      );
      return [resource, provenance];
    });
    const bundle = buildCollectionBundle(resources, { id: "export-1", timestamp: "2026-09-06T00:00:00Z" });

    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("collection");
    expect(bundle.total).toBe(resources.length);
    expect(bundle.entry).toHaveLength(resources.length);
    expect(bundle.entry?.map((e) => e.fullUrl)).toEqual(resources.map((r) => `urn:uuid:${r.id}`));
    expect(bundle.entry?.map((e) => e.resource)).toEqual(resources);
    expect(validateResource(bundle, { ig: version })).toEqual({ ok: true });
  });

  it("wraps zero resources", () => {
    const bundle = buildCollectionBundle([]);
    expect(bundle).toEqual({ resourceType: "Bundle", type: "collection", total: 0, entry: [] });
    expect(validateResource(bundle, { ig: version })).toEqual({ ok: true });
  });

  it("surfaces entry failures with the entry index in the path", () => {
    const ok = getIg(version).serializeAllergyIntolerance(loadCanonicalAllergy("allergy-patient-entered"));
    const broken = clone(ok);
    delete broken.meta;
    const result = validateResource(buildCollectionBundle([ok, broken]), { ig: version });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures.map((f) => f.path)).toEqual(["Bundle.entry[1].resource.AllergyIntolerance.meta.profile"]);
  });
});
