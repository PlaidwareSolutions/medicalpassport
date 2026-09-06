import { describe, expect, it } from "vitest";
import {
  DEFAULT_IG_VERSION,
  ProvenanceMissingError,
  SUPPORTED_IG_VERSIONS,
  UnsupportedIgVersionError,
  allIgs,
  getIg,
  isSupportedIgVersion,
  serialize,
  validateResource,
} from "../src/index.js";
import { loadCanonicalAllergy } from "./helpers.js";

describe("version-mapper", () => {
  it("lists the pinned folders", () => {
    expect(SUPPORTED_IG_VERSIONS).toEqual(["6.5", "7.0"]);
    expect(DEFAULT_IG_VERSION).toBe("6.5");
    expect(allIgs().map((ig) => ig.version)).toEqual(["6.5", "7.0"]);
  });

  it("returns a frozen folder API on R4", () => {
    for (const version of SUPPORTED_IG_VERSIONS) {
      const ig = getIg(version);
      expect(ig.version).toBe(version);
      expect(ig.fhirVersion).toBe("4.0.1");
      expect(Object.isFrozen(ig)).toBe(true);
      expect(ig.profiles.AllergyIntolerance).toBe("https://nrces.in/ndhm/fhir/r4/StructureDefinition/AllergyIntolerance");
    }
  });

  it("rejects unknown versions", () => {
    expect(isSupportedIgVersion("6.5")).toBe(true);
    expect(isSupportedIgVersion("6.4")).toBe(false);
    expect(() => getIg("6.4")).toThrow(UnsupportedIgVersionError);
  });
});

describe.each(SUPPORTED_IG_VERSIONS)("serialize(entity, { ig: %s })", (version) => {
  it("returns the resource plus a Provenance that targets it", () => {
    const canonical = loadCanonicalAllergy("allergy-clinic-verified");
    const { resource, provenance } = serialize({ kind: "AllergyIntolerance", canonical }, { ig: version });
    expect(resource.resourceType).toBe("AllergyIntolerance");
    expect(provenance.target).toEqual([{ reference: `AllergyIntolerance/${canonical.id}` }]);
    expect(validateResource(resource, { ig: version })).toEqual({ ok: true });
    expect(validateResource(provenance, { ig: version })).toEqual({ ok: true });
  });

  it("throws ProvenanceMissingError before producing anything", () => {
    const canonical = { ...loadCanonicalAllergy("allergy-patient-entered"), provenance: null };
    expect(() => serialize({ kind: "AllergyIntolerance", canonical }, { ig: version })).toThrow(ProvenanceMissingError);
  });
});

it("emits identical AllergyIntolerance bodies across IG folders for the same row (diff test)", () => {
  const canonical = loadCanonicalAllergy("allergy-clinic-verified");
  const [a, b] = allIgs().map((ig) => ig.serializeAllergyIntolerance(canonical));
  expect(a).toEqual(b);
});
