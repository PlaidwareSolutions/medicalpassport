/**
 * Conformance suite for the docs_v2/08 section 6 priority artifacts (#1–#15 minus the allergy,
 * which has its own file): every canonical fixture serializes to its golden resource in every IG
 * folder, the golden validates, the profile is declared, and a row without provenance is refused.
 */
import { describe, expect, it } from "vitest";
import {
  CODE_SYSTEMS,
  MEDPASS_SYSTEMS,
  ProvenanceMissingError,
  SUPPORTED_IG_VERSIONS,
  acceptedProfiles,
  getIg,
  serialize,
  validateResource,
  type CanonicalCondition,
  type CanonicalLabObservation,
  type CanonicalVitalObservation,
  type ClinicalResource,
  type ObservationResource,
  type ProfiledResourceType,
  type SerializableEntity,
  type SerializableKind,
} from "../../src/index.js";
import { clone, loadCanonical, loadGolden } from "../helpers.js";

interface Case {
  kind: SerializableKind;
  canonical: string;
  golden: string;
  /** Resource type the profile check is keyed on. */
  resourceType: ProfiledResourceType;
  /** Warnings the serializer must report (mapping gaps), by path suffix. */
  warnings?: string[];
}

const CASES: Case[] = [
  { kind: "Patient", canonical: "patient-abha-linked", golden: "patient.abha-linked.json", resourceType: "Patient" },
  { kind: "Patient", canonical: "patient-minimal", golden: "patient.minimal.json", resourceType: "Patient" },
  { kind: "Practitioner", canonical: "practitioner-hpr", golden: "practitioner.hpr.json", resourceType: "Practitioner" },
  { kind: "Practitioner", canonical: "practitioner-patient-added", golden: "practitioner.patient-added.json", resourceType: "Practitioner" },
  { kind: "Organization", canonical: "organization-hfr", golden: "organization.hfr.json", resourceType: "Organization" },
  { kind: "Organization", canonical: "organization-lab", golden: "organization.lab.json", resourceType: "Organization" },
  { kind: "Medication", canonical: "medication-catalog", golden: "medication.catalog.json", resourceType: "Medication" },
  { kind: "Medication", canonical: "medication-rxnorm", golden: "medication.rxnorm.json", resourceType: "Medication" },
  { kind: "MedicationRequest", canonical: "medication-request-bd-after-food", golden: "medication-request.bd-after-food.json", resourceType: "MedicationRequest" },
  { kind: "MedicationRequest", canonical: "medication-request-pattern-uncoded", golden: "medication-request.pattern-uncoded.json", resourceType: "MedicationRequest" },
  { kind: "MedicationStatement", canonical: "medication-statement-current", golden: "medication-statement.current.json", resourceType: "MedicationStatement" },
  { kind: "MedicationStatement", canonical: "medication-statement-paused-prn", golden: "medication-statement.paused-prn.json", resourceType: "MedicationStatement" },
  { kind: "DiagnosticReport", canonical: "diagnostic-report-lab", golden: "diagnostic-report.lab.json", resourceType: "DiagnosticReport" },
  { kind: "DiagnosticReport", canonical: "diagnostic-report-imaging", golden: "diagnostic-report.imaging.json", resourceType: "DiagnosticReport" },
  { kind: "ObservationLab", canonical: "observation-lab-hba1c", golden: "observation-lab.hba1c.json", resourceType: "Observation" },
  { kind: "ObservationLab", canonical: "observation-lab-unmapped", golden: "observation-lab.unmapped.json", resourceType: "Observation", warnings: ["Observation.code", "Observation.valueQuantity.code"] },
  { kind: "ObservationVital", canonical: "observation-vital-bp", golden: "observation-vital.bp.json", resourceType: "Observation" },
  { kind: "ObservationVital", canonical: "observation-vital-weight", golden: "observation-vital.weight.json", resourceType: "Observation" },
  { kind: "ObservationVital", canonical: "observation-vital-heart-rate", golden: "observation-vital.heart-rate.json", resourceType: "Observation" },
  { kind: "ObservationVital", canonical: "observation-vital-spo2", golden: "observation-vital.spo2.json", resourceType: "Observation" },
  { kind: "ObservationVital", canonical: "observation-wellness-steps", golden: "observation-wellness.steps.json", resourceType: "Observation", warnings: ["Observation.code"] },
  { kind: "Condition", canonical: "condition-snomed", golden: "condition.snomed.json", resourceType: "Condition" },
  { kind: "Condition", canonical: "condition-uncoded-resolved", golden: "condition.uncoded-resolved.json", resourceType: "Condition", warnings: ["Condition.code"] },
  { kind: "DocumentReference", canonical: "document-lab-report", golden: "document-reference.lab-report.json", resourceType: "DocumentReference" },
  { kind: "DocumentReference", canonical: "document-strip-photo", golden: "document-reference.prescription-photo.json", resourceType: "DocumentReference" },
];

function entity(c: Case): SerializableEntity {
  return { kind: c.kind, canonical: loadCanonical(c.canonical) } as SerializableEntity;
}

describe.each(SUPPORTED_IG_VERSIONS)("priority artifacts — IG %s", (version) => {
  const ig = getIg(version);

  describe.each(CASES)("$kind ← $canonical", (c) => {
    it("serializes to the golden resource for this IG folder", () => {
      const { resource } = serialize(entity(c), { ig: version });
      expect(resource).toEqual(loadGolden<ClinicalResource>(version, c.golden));
    });

    it("golden resource passes the validator and declares an accepted profile", () => {
      const golden = loadGolden<ClinicalResource>(version, c.golden);
      expect(validateResource(golden, { ig: version })).toEqual({ ok: true });
      const accepted = acceptedProfiles(ig, c.resourceType);
      expect(golden.meta?.profile?.some((p) => accepted.includes(p))).toBe(true);
    });

    it("emits a Provenance that targets the resource and validates", () => {
      const { resource, provenance } = serialize(entity(c), { ig: version, softwareVersion: "api@test" });
      expect(provenance.target).toEqual([{ reference: `${resource.resourceType}/${resource.id}` }]);
      expect(provenance.agent.at(-1)?.who.identifier?.value).toBe(`api@test;ig=${version}`);
      expect(validateResource(provenance, { ig: version })).toEqual({ ok: true });
    });

    it("reports exactly the expected mapping warnings", () => {
      const { warnings } = serialize(entity(c), { ig: version });
      expect(warnings.map((w) => w.path)).toEqual(c.warnings ?? []);
      for (const w of warnings) {
        expect(w).toMatchObject({ severity: "warning", igVersion: version, resourceType: c.resourceType });
        expect(w.profileUrl.length).toBeGreaterThan(0);
      }
    });

    it("refuses the row without provenance (ProvenanceMissingError, fails closed)", () => {
      const e = entity(c);
      const broken = { kind: e.kind, canonical: { ...clone(e.canonical), provenance: null } } as SerializableEntity;
      expect(() => serialize(broken, { ig: version })).toThrow(ProvenanceMissingError);
      const noVerification = clone(e.canonical) as unknown as { provenance: Record<string, unknown> };
      delete noVerification.provenance["verification"];
      expect(() => serialize({ kind: e.kind, canonical: noVerification } as unknown as SerializableEntity, { ig: version })).toThrow(ProvenanceMissingError);
    });
  });

  describe("lab Observation terminology binding (#6)", () => {
    it("carries LOINC + UCUM from @medpass/terminology for a mapped analyte", () => {
      const { resource } = serialize({ kind: "ObservationLab", canonical: loadCanonical<CanonicalLabObservation>("observation-lab-hba1c") }, { ig: version });
      const obs = resource as ObservationResource;
      expect(obs.code.coding?.[0]).toMatchObject({ system: CODE_SYSTEMS.loinc, code: "4548-4" });
      expect(obs.valueQuantity).toEqual({ value: 6.8, unit: "%", system: CODE_SYSTEMS.ucum, code: "%" });
      expect(obs.interpretation?.[0]?.coding?.[0]?.code).toBe("H");
      expect(obs.referenceRange?.[0]).toMatchObject({ low: { value: 4 }, high: { value: 5.6 }, text: "4.0 - 5.6 %" });
    });

    it("exports an unmapped analyte with the local code + text and a FhirValidationFailure-shaped warning", () => {
      const { resource, warnings } = serialize({ kind: "ObservationLab", canonical: loadCanonical<CanonicalLabObservation>("observation-lab-unmapped") }, { ig: version });
      const obs = resource as ObservationResource;
      expect(obs.code).toEqual({ text: "Serum Ferritin", coding: [{ system: MEDPASS_SYSTEMS.csAnalyte, code: "other", display: "Serum Ferritin" }] });
      expect(obs.valueQuantity).toEqual({ value: 12, unit: "ng/mL", comparator: "<" });
      expect(warnings[0]).toEqual({
        path: "Observation.code",
        severity: "warning",
        message: expect.stringContaining("no LOINC mapping"),
        profileUrl: ig.profiles.Observation,
        resourceType: "Observation",
        igVersion: version,
      });
    });
  });

  describe("vital signs (#9–#12)", () => {
    it("blood pressure carries systolic/diastolic components with LOINC and the vital-signs category", () => {
      const { resource } = serialize({ kind: "ObservationVital", canonical: loadCanonical<CanonicalVitalObservation>("observation-vital-bp") }, { ig: version });
      const obs = resource as ObservationResource;
      expect(obs.component?.map((c) => [c.code.coding?.[0]?.code, c.valueQuantity?.value])).toEqual([
        ["8480-6", 128],
        ["8462-4", 82],
      ]);
      expect(obs.valueQuantity).toBeUndefined();
      expect(obs.category?.[0]?.coding?.[0]?.code).toBe("vital-signs");
      expect(obs.meta?.profile).toContain(CODE_SYSTEMS.vitalSignsProfile);
    });

    it.each([
      ["observation-vital-weight", "29463-7", "kg"],
      ["observation-vital-heart-rate", "8867-4", "/min"],
      ["observation-vital-spo2", "2708-6", "%"],
    ])("%s uses LOINC %s and UCUM %s", (name, loinc, ucum) => {
      const { resource } = serialize({ kind: "ObservationVital", canonical: loadCanonical<CanonicalVitalObservation>(name) }, { ig: version });
      const obs = resource as ObservationResource;
      expect(obs.code.coding?.some((c) => c.system === CODE_SYSTEMS.loinc && c.code === loinc)).toBe(true);
      expect(obs.valueQuantity).toMatchObject({ system: CODE_SYSTEMS.ucum, code: ucum });
    });

    it("a wellness concept is not a vital sign: base category, no vital-signs profile", () => {
      const { resource } = serialize({ kind: "ObservationVital", canonical: loadCanonical<CanonicalVitalObservation>("observation-wellness-steps") }, { ig: version });
      expect(resource.meta?.profile).toEqual([ig.profiles.Observation]);
      expect((resource as ObservationResource).category?.[0]?.coding?.[0]?.code).toBe("activity");
    });
  });

  describe("Condition (#13)", () => {
    it("verification never over-claims: patient-entered exports unconfirmed, provider-verified confirmed", () => {
      const own = serialize({ kind: "Condition", canonical: loadCanonical<CanonicalCondition>("condition-uncoded-resolved") }, { ig: version }).resource;
      const clinic = serialize({ kind: "Condition", canonical: loadCanonical<CanonicalCondition>("condition-snomed") }, { ig: version }).resource;
      expect((own as { verificationStatus?: { coding?: Array<{ code?: string }> } }).verificationStatus?.coding?.[0]?.code).toBe("unconfirmed");
      expect((clinic as { verificationStatus?: { coding?: Array<{ code?: string }> } }).verificationStatus?.coding?.[0]?.code).toBe("confirmed");
    });

    it("round-trips through the parser (provenance stamped by the importer)", () => {
      const canonical = loadCanonical<CanonicalCondition>("condition-snomed");
      const first = ig.serializeCondition(canonical).resource;
      const candidate = ig.parseCondition(clone(first));
      expect("provenance" in candidate).toBe(false);
      expect(candidate).toMatchObject({ id: canonical.id, label: canonical.label, clinicalStatus: "active", code: "44054006", codeSystem: CODE_SYSTEMS.snomed });
      const second = ig.serializeCondition({ ...candidate, diagnosedByPractitionerId: canonical.diagnosedByPractitionerId, provenance: canonical.provenance }).resource;
      expect(second).toEqual(first);
    });
  });

  describe("DocumentReference (#15)", () => {
    it("attaches pages by opaque reference and the validator rejects an http(s) URL", () => {
      const golden = loadGolden<{ content: Array<{ attachment: { url?: string; contentType?: string } }> }>(version, "document-reference.lab-report.json");
      expect(golden.content.map((c) => c.attachment.url)).toEqual([
        `${MEDPASS_SYSTEMS.storedObject}:ee5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b`,
        `${MEDPASS_SYSTEMS.storedObject}:ff6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c`,
      ]);
      const leaking = clone(golden) as unknown as ClinicalResource & { content: Array<{ attachment: { url?: string } }> };
      leaking.content[0]!.attachment.url = "https://r2.example.com/bucket/page-1.jpg";
      const result = validateResource(leaking, { ig: version });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failures.map((f) => f.path)).toEqual(["DocumentReference.content[0].attachment.url"]);
    });
  });
});

it("emits identical clinical bodies across IG folders except where v7 adds profiles (diff test)", () => {
  const [a, b] = SUPPORTED_IG_VERSIONS.map((ig) => serialize({ kind: "MedicationRequest", canonical: loadCanonical("medication-request-bd-after-food") }, { ig }).resource);
  expect(a).toEqual(b);
  const bp65 = serialize({ kind: "ObservationVital", canonical: loadCanonical("observation-vital-bp") }, { ig: "6.5" }).resource;
  const bp70 = serialize({ kind: "ObservationVital", canonical: loadCanonical("observation-vital-bp") }, { ig: "7.0" }).resource;
  expect({ ...bp65, meta: undefined }).toEqual({ ...bp70, meta: undefined });
  expect(bp65.meta?.profile).toEqual([CODE_SYSTEMS.vitalSignsProfile]);
  expect(bp70.meta?.profile?.[0]).toBe("https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationBP");
});
