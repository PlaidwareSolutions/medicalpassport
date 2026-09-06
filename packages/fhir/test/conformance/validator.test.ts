import { describe, expect, it } from "vitest";
import {
  SUPPORTED_IG_VERSIONS,
  UnsupportedIgVersionError,
  getIg,
  validateResource,
  type AllergyIntoleranceResource,
} from "../../src/index.js";
import { clone, loadCanonicalAllergy } from "../helpers.js";

const PROFILE = "https://nrces.in/ndhm/fhir/r4/StructureDefinition/AllergyIntolerance";

function failuresOf(resource: unknown, ig: (typeof SUPPORTED_IG_VERSIONS)[number]) {
  const result = validateResource(resource, { ig });
  if (result.ok) throw new Error("expected validation to fail");
  return result.failures;
}

describe.each(SUPPORTED_IG_VERSIONS)("validateResource — IG %s", (version) => {
  const good = (): AllergyIntoleranceResource =>
    clone(getIg(version).serializeAllergyIntolerance(loadCanonicalAllergy("allergy-clinic-verified")));

  it("reports a path, severity, message and profileUrl for a deliberately broken resource", () => {
    const broken = good();
    delete (broken as Partial<AllergyIntoleranceResource>).patient;
    broken.reaction![0]!.manifestation = [];

    const failures = failuresOf(broken, version);
    expect(failures.map((f) => f.path).sort()).toEqual([
      "AllergyIntolerance.patient",
      "AllergyIntolerance.reaction[0].manifestation",
    ]);
    for (const f of failures) {
      expect(f).toMatchObject({
        severity: "error",
        profileUrl: PROFILE,
        resourceType: "AllergyIntolerance",
        igVersion: version,
      });
      expect(f.message.length).toBeGreaterThan(0);
    }
  });

  it("flags a missing IG profile declaration at meta.profile", () => {
    const broken = good();
    broken.meta = { profile: ["http://hl7.org/fhir/StructureDefinition/AllergyIntolerance"] };
    const failures = failuresOf(broken, version);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ path: "AllergyIntolerance.meta.profile", profileUrl: PROFILE });
    expect(failures[0]?.message).toContain(version);
  });

  it("rejects unknown elements (strict R4 element list)", () => {
    const broken = good() as AllergyIntoleranceResource & { severity?: string };
    broken.severity = "severe";
    expect(failuresOf(broken, version).some((f) => f.path === "AllergyIntolerance.severity")).toBe(true);
  });

  it("enforces ait-1 (clinicalStatus required unless entered-in-error)", () => {
    const broken = good();
    delete broken.clinicalStatus;
    expect(failuresOf(broken, version).map((f) => f.path)).toEqual(["AllergyIntolerance.clinicalStatus"]);
  });

  it("rejects a dateTime without timezone", () => {
    const broken = good();
    broken.recordedDate = "2026-08-14T09:30:00";
    expect(failuresOf(broken, version).map((f) => f.path)).toEqual(["AllergyIntolerance.recordedDate"]);
  });

  it("never throws on garbage input", () => {
    expect(failuresOf(null, version)[0]).toMatchObject({ path: "Resource.resourceType", severity: "fatal" });
    expect(failuresOf({ resourceType: "Immunization" }, version)[0]).toMatchObject({
      path: "Immunization.resourceType",
      severity: "fatal",
      profileUrl: "http://hl7.org/fhir/StructureDefinition/Immunization",
    });
  });
});

it("validateResource rejects an unsupported IG version", () => {
  expect(() => validateResource({ resourceType: "Bundle", type: "collection" }, { ig: "5.0" as never })).toThrow(
    UnsupportedIgVersionError,
  );
});
