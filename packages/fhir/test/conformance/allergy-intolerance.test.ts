import { describe, expect, it } from "vitest";
import {
  ProvenanceMissingError,
  SUPPORTED_IG_VERSIONS,
  getIg,
  validateResource,
  type AllergyIntoleranceResource,
  type CanonicalAllergy,
  type IgVersion,
} from "../../src/index.js";
import { CANONICAL_ALLERGY_FIXTURES, clone, loadCanonicalAllergy, loadFixture } from "../helpers.js";

const FOLDER: Record<IgVersion, string> = { "6.5": "v6_5", "7.0": "v7_0" };
const PROFILE = "https://nrces.in/ndhm/fhir/r4/StructureDefinition/AllergyIntolerance";

describe.each(SUPPORTED_IG_VERSIONS)("AllergyIntolerance conformance — IG %s", (version) => {
  const ig = getIg(version);

  describe.each([
    ["allergy-clinic-verified", "allergy-intolerance.clinic-verified.json"],
    ["allergy-patient-entered", "allergy-intolerance.patient-entered.json"],
  ] as const)("fixture %s", (canonicalName, expectedFile) => {
    it("serializes to the golden resource for this IG folder", () => {
      const canonical = loadCanonicalAllergy(canonicalName);
      const expected = loadFixture<AllergyIntoleranceResource>(`${FOLDER[version]}/${expectedFile}`);
      expect(ig.serializeAllergyIntolerance(canonical)).toEqual(expected);
    });

    it("golden resource passes the validator", () => {
      const expected = loadFixture<AllergyIntoleranceResource>(`${FOLDER[version]}/${expectedFile}`);
      expect(validateResource(expected, { ig: version })).toEqual({ ok: true });
    });
  });

  describe.each(CANONICAL_ALLERGY_FIXTURES)("canonical %s", (name) => {
    it("serialize -> validate is ok and declares the IG profile", () => {
      const resource = ig.serializeAllergyIntolerance(loadCanonicalAllergy(name));
      expect(resource.meta?.profile).toEqual([PROFILE]);
      expect(validateResource(resource, { ig: version })).toEqual({ ok: true });
    });

    it("serialize -> parse -> serialize is stable (round trip)", () => {
      const canonical = loadCanonicalAllergy(name);
      const first = ig.serializeAllergyIntolerance(canonical);
      const candidate = ig.parseAllergyIntolerance(clone(first));
      // The importer stamps provenance; the payload never carries it back (ADR-V2-002).
      const second = ig.serializeAllergyIntolerance({ ...candidate, provenance: canonical.provenance });
      expect(second).toEqual(first);
    });

    it("parse recovers the canonical fields", () => {
      const canonical = loadCanonicalAllergy(name);
      const candidate = ig.parseAllergyIntolerance(ig.serializeAllergyIntolerance(canonical));
      expect(candidate.id).toBe(canonical.id);
      expect(candidate.patient.patientProfileId).toBe(canonical.patient.patientProfileId);
      expect(candidate.substanceText).toBe(canonical.substanceText);
      expect(candidate.category).toBe(canonical.category);
      expect(candidate.clinicalStatus).toBe(canonical.clinicalStatus);
      expect(candidate.criticality).toBe(canonical.criticality);
      expect(candidate.severity).toBe(canonical.severity);
      expect(candidate.reactionText).toBe(canonical.reactionText);
      expect(candidate.onsetDate).toBe(canonical.onsetDate);
      expect(candidate.code).toBe(canonical.code);
      expect(candidate.codeSystem).toBe(canonical.codeSystem);
      expect(candidate.notes).toBe(canonical.notes);
      expect("provenance" in candidate).toBe(false);
    });
  });

  describe("provenance fails closed (ADR-V2-002)", () => {
    it("throws ProvenanceMissingError when provenance is null", () => {
      const canonical: CanonicalAllergy = { ...loadCanonicalAllergy("allergy-clinic-verified"), provenance: null };
      expect(() => ig.serializeAllergyIntolerance(canonical)).toThrow(ProvenanceMissingError);
    });

    it("throws ProvenanceMissingError when the block lacks verification", () => {
      const canonical = clone(loadCanonicalAllergy("allergy-clinic-verified"));
      delete (canonical.provenance as unknown as Record<string, unknown>)["verification"];
      let caught: unknown;
      try {
        ig.serializeAllergyIntolerance(canonical);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ProvenanceMissingError);
      expect((caught as ProvenanceMissingError).code).toBe("fhir_provenance_missing");
      expect((caught as ProvenanceMissingError).entityId).toBe(canonical.id);
    });
  });

  describe("verification mapping never over-claims", () => {
    const verificationCode = (c: CanonicalAllergy): string | undefined =>
      ig.serializeAllergyIntolerance(c).verificationStatus?.coding?.[0]?.code;

    it.each(["unverified", "patient_confirmed"] as const)("%s exports as unconfirmed", (state) => {
      const canonical = clone(loadCanonicalAllergy("allergy-clinic-verified"));
      canonical.provenance!.verification = state;
      expect(verificationCode(canonical)).toBe("unconfirmed");
    });

    it.each(["provider_verified", "source_authenticated"] as const)("%s exports as confirmed", (state) => {
      const canonical = clone(loadCanonicalAllergy("allergy-patient-entered"));
      canonical.provenance!.verification = state;
      expect(verificationCode(canonical)).toBe("confirmed");
    });
  });

  it("category other is omitted on export and recovered on parse", () => {
    const canonical = clone(loadCanonicalAllergy("allergy-ocr-extracted"));
    canonical.category = "other";
    const resource = ig.serializeAllergyIntolerance(canonical);
    expect(resource.category).toBeUndefined();
    expect(ig.parseAllergyIntolerance(resource).category).toBe("other");
  });
});
