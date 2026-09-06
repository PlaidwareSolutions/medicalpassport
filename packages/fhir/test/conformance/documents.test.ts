/**
 * Document bundles: PrescriptionRecord (#1), DiagnosticReportRecord (#5/#7) on both folders and
 * the Indian Patient Summary (docs_v2/08 section 8) on v7.0 only.
 */
import { describe, expect, it } from "vitest";
import {
  ArtifactNotSupportedError,
  ProvenanceMissingError,
  SUPPORTED_IG_VERSIONS,
  getIg,
  serializeDiagnosticReportRecord,
  serializePatientSummary,
  serializePrescriptionRecord,
  validateResource,
  type BundleResource,
  type CanonicalDiagnosticReportRecord,
  type CanonicalPatientSummary,
  type CanonicalPrescriptionRecord,
  type CompositionResource,
  type ProvenanceResource,
} from "../../src/index.js";
import { clone, loadCanonical, loadGolden } from "../helpers.js";

/** Every non-Provenance entry must be the target of exactly one Provenance entry in the same bundle. */
function expectEveryEntryProvenanced(bundle: BundleResource): void {
  const entries = bundle.entry ?? [];
  const targets = new Set(
    entries
      .map((e) => e.resource)
      .filter((r): r is ProvenanceResource => r?.resourceType === "Provenance")
      .flatMap((p) => p.target.map((t) => t.reference)),
  );
  const clinical = entries.map((e) => e.resource!).filter((r) => r.resourceType !== "Provenance");
  expect(clinical.length).toBeGreaterThan(0);
  for (const r of clinical) expect(targets.has(`${r.resourceType}/${r.id}`)).toBe(true);
}

describe.each(SUPPORTED_IG_VERSIONS)("document bundles — IG %s", (version) => {
  const ig = getIg(version);

  describe("PrescriptionRecord (#1)", () => {
    const record = () => loadCanonical<CanonicalPrescriptionRecord>("prescription-record");

    it("matches the golden bundle and validates (Composition first, timestamp, profiles)", () => {
      const { bundle, warnings } = serializePrescriptionRecord(record(), { ig: version, softwareVersion: "api@test" });
      expect(bundle).toEqual(loadGolden<BundleResource>(version, "prescription-record.json"));
      expect(validateResource(bundle, { ig: version })).toEqual({ ok: true });
      expect(warnings).toEqual([]);
      expect(bundle.type).toBe("document");
      expect(bundle.entry?.[0]?.resource?.resourceType).toBe("Composition");
      expect((bundle.entry?.[0]?.resource as CompositionResource).meta?.profile).toEqual([ig.profiles.Composition]);
    });

    it("carries the practitioner, organization, catalog Medication, every item and the original document", () => {
      const { bundle } = serializePrescriptionRecord(record(), { ig: version });
      const types = (bundle.entry ?? []).map((e) => e.resource!.resourceType).filter((t) => t !== "Provenance");
      expect(types).toEqual(["Composition", "Patient", "Practitioner", "Organization", "Medication", "MedicationRequest", "MedicationRequest", "DocumentReference"]);
      const composition = bundle.entry?.[0]?.resource as CompositionResource;
      expect(composition.section?.[0]?.entry?.map((e) => e.reference)).toEqual([
        "MedicationRequest/6e7f8a9b-0c1d-4e2f-9a3b-4c5d6e7f8a9b",
        "MedicationRequest/7f8a9b0c-1d2e-4f3a-8b4c-5d6e7f8a9b0c",
        "DocumentReference/aa0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
      ]);
      expect(composition.author).toEqual([{ reference: "Practitioner/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }]);
      expectEveryEntryProvenanced(bundle);
    });

    it("refuses an item without provenance before emitting anything", () => {
      const broken = record();
      broken.items[1]!.provenance = null;
      expect(() => serializePrescriptionRecord(broken, { ig: version })).toThrow(ProvenanceMissingError);
    });

    it("honours bundleId / timestamp from the caller", () => {
      const { bundle } = serializePrescriptionRecord(record(), { ig: version, bundleId: "export-42", timestamp: "2026-09-06T10:00:00.000Z" });
      expect(bundle.id).toBe("export-42");
      expect(bundle.timestamp).toBe("2026-09-06T10:00:00.000Z");
      expect((bundle.entry?.[0]?.resource as CompositionResource).date).toBe("2026-09-06T10:00:00.000Z");
      expect(validateResource(bundle, { ig: version })).toEqual({ ok: true });
    });
  });

  describe("DiagnosticReportRecord (#5)", () => {
    const record = () => loadCanonical<CanonicalDiagnosticReportRecord>("diagnostic-report-record");

    it("matches the golden bundle, validates, and surfaces the results' mapping warnings", () => {
      const { bundle, warnings } = serializeDiagnosticReportRecord(record(), { ig: version, softwareVersion: "api@test" });
      expect(bundle).toEqual(loadGolden<BundleResource>(version, "diagnostic-report-record.json"));
      expect(validateResource(bundle, { ig: version })).toEqual({ ok: true });
      expect(warnings.map((w) => w.path)).toEqual(["Observation.code", "Observation.valueQuantity.code"]);
      expectEveryEntryProvenanced(bundle);
    });

    it("declares the DiagnosticReportRecord composition profile and lab report profile", () => {
      const { bundle } = serializeDiagnosticReportRecord(record(), { ig: version });
      const composition = bundle.entry?.[0]?.resource as CompositionResource;
      expect(composition.meta?.profile).toEqual(["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord"]);
      const report = bundle.entry?.find((e) => e.resource?.resourceType === "DiagnosticReport")?.resource;
      expect(report?.meta?.profile).toEqual([ig.profiles.DiagnosticReport]);
      expect(composition.section?.[0]?.entry?.[0]?.reference).toBe("DiagnosticReport/ab1c2d3e-4f5a-4b6c-9d7e-8f9a0b1c2d3e");
    });

    it("an imaging report declares the imaging profile (#7)", () => {
      const imaging = { ...record(), report: loadCanonical<CanonicalDiagnosticReportRecord["report"]>("diagnostic-report-imaging"), results: [], documents: [] };
      const { bundle } = serializeDiagnosticReportRecord(imaging, { ig: version });
      const report = bundle.entry?.find((e) => e.resource?.resourceType === "DiagnosticReport")?.resource;
      expect(report?.meta?.profile).toEqual(["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportImaging"]);
      expect(validateResource(bundle, { ig: version })).toEqual({ ok: true });
    });
  });

  it("a document bundle that does not open with a Composition fails bdl-11", () => {
    const { bundle } = serializePrescriptionRecord(loadCanonical("prescription-record"), { ig: version });
    const broken = clone(bundle);
    broken.entry!.shift();
    const result = validateResource(broken, { ig: version });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures[0]).toMatchObject({ path: "Bundle.entry[0].resource", message: expect.stringContaining("bdl-11") });
  });
});

describe("Indian Patient Summary (docs_v2/08 section 8)", () => {
  const summary = () => loadCanonical<CanonicalPatientSummary>("patient-summary");

  it("is a v7.0-only artifact", () => {
    expect(getIg("6.5").supportsPatientSummary).toBe(false);
    expect(getIg("7.0").supportsPatientSummary).toBe(true);
    expect(() => serializePatientSummary(summary(), { ig: "6.5" })).toThrow(ArtifactNotSupportedError);
  });

  it("matches the golden bundle and validates on v7.0", () => {
    const { bundle } = serializePatientSummary(summary(), { ig: "7.0", softwareVersion: "api@test", timestamp: "2026-09-06T00:00:00.000Z" });
    expect(bundle).toEqual(loadGolden<BundleResource>("7.0", "patient-summary.json"));
    expect(validateResource(bundle, { ig: "7.0" })).toEqual({ ok: true });
    expectEveryEntryProvenanced(bundle);
  });

  it("limits sections to confirmed rows and reports each omission", () => {
    const { bundle, warnings } = serializePatientSummary(summary(), { ig: "7.0" });
    const composition = bundle.entry?.[0]?.resource as CompositionResource;
    const sections = Object.fromEntries((composition.section ?? []).map((s) => [s.code?.coding?.[0]?.code, s.entry?.map((e) => e.reference) ?? []]));
    // The OCR-extracted allergy (unverified) and the device-recorded BP (unverified) are left out.
    expect(sections["48765-2"]).toEqual(["AllergyIntolerance/6c1a6c1e-3d1a-4d3f-9a9e-8f2b0c7d1a01"]);
    expect(sections["8716-3"]).toEqual(["Observation/1b2c3d4e-5f6a-4b7c-9d8e-9f0a1b2c3d4e"]);
    expect(sections["10160-0"]).toHaveLength(2);
    expect(sections["11450-4"]).toHaveLength(2);
    expect(warnings.filter((w) => w.severity === "information").map((w) => w.message)).toEqual([
      expect.stringContaining("AllergyIntolerance/8e3c8e30-5f3c-4f51-9c10-ab4d2e9f3c03 omitted"),
      expect.stringContaining("Observation/0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d omitted"),
    ]);
  });

  it("always emits the three required IPS sections, with emptyReason when nothing is confirmed", () => {
    const empty: CanonicalPatientSummary = { ...summary(), medications: [], catalog: [], allergies: [], conditions: [], results: [], vitals: [] };
    const { bundle } = serializePatientSummary(empty, { ig: "7.0" });
    const composition = bundle.entry?.[0]?.resource as CompositionResource;
    expect(composition.section?.map((s) => [s.code?.coding?.[0]?.code, s.emptyReason?.coding?.[0]?.code])).toEqual([
      ["10160-0", "unavailable"],
      ["48765-2", "unavailable"],
      ["11450-4", "unavailable"],
    ]);
    expect(validateResource(bundle, { ig: "7.0" })).toEqual({ ok: true });
  });

  it("refuses a patient row without provenance", () => {
    const broken = summary();
    broken.patient.provenance = null;
    expect(() => serializePatientSummary(broken, { ig: "7.0" })).toThrow(ProvenanceMissingError);
  });
});
