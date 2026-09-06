/**
 * Inbound direction (docs_v2/08 section 7): a received bundle becomes candidate drafts only.
 * The parser never produces provenance and never a canonical row.
 */
import { describe, expect, it } from "vitest";
import { parseBundleToCandidates, serializePrescriptionRecord, serializeDiagnosticReportRecord, type CanonicalDiagnosticReportRecord, type CanonicalPrescriptionRecord } from "../src/index.js";
import { loadCanonical } from "./helpers.js";

describe("parseBundleToCandidates", () => {
  it("turns an exported PrescriptionRecord back into medication / practitioner / organization / prescription candidates", () => {
    const { bundle } = serializePrescriptionRecord(loadCanonical<CanonicalPrescriptionRecord>("prescription-record"), { ig: "6.5" });
    const parsed = parseBundleToCandidates(bundle);

    expect(parsed.resourceCount).toBe(bundle.entry!.length);
    // Provenance, Patient, Medication (catalog) and DocumentReference entries have no extraction
    // target of their own: reported, not silently dropped. (The document's pages are imported as the
    // PatientDocument the candidates hang off, not as a candidate.)
    expect(parsed.unsupported.map((u) => u.resourceType).sort()).toEqual(["DocumentReference", "Medication", "Patient", ...Array(8).fill("Provenance")].sort());

    const byGroup = new Map<string, Array<[string, string, unknown]>>();
    for (const c of parsed.candidates) {
      const list = byGroup.get(c.groupKey) ?? [];
      list.push([c.targetEntity, c.targetField, c.proposedValue]);
      byGroup.set(c.groupKey, list);
    }
    expect(byGroup.get("MedicationRequest/6e7f8a9b-0c1d-4e2f-9a3b-4c5d6e7f8a9b")).toEqual([
      ["medication", "genericName", "Metformin"],
      ["medication", "instructionsText", "1 tab BD after food x 30 days"],
      ["medication", "frequency", { code: "BD" }],
      ["medication", "foodInstruction", "after"],
      ["medication", "durationDays", 30],
    ]);
    expect(byGroup.get("MedicationRequest/7f8a9b0c-1d2e-4f3a-8b4c-5d6e7f8a9b0c")).toEqual([
      ["medication", "genericName", "Pantoprazole"],
      ["medication", "strengthLabel", { value: "40", unit: "mg" }],
      ["medication", "form", "tablet"],
      ["medication", "instructionsText", "1-0-1 before meals"],
      ["medication", "frequency", { code: "BD" }],
      ["medication", "foodInstruction", "before"],
    ]);
    expect(byGroup.get("Practitioner/1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d")).toEqual([
      ["practitioner", "displayName", "Dr. Meera Iyer"],
      ["practitioner", "speciality", "General Physician"],
      ["practitioner", "registrationNumber", "TNMC/12345"],
    ]);
    expect(byGroup.get("Organization/0b1c2d3e-4f50-4a6b-9c7d-8e9f0a1b2c3d")).toEqual([
      ["organization", "displayName", "Apollo Clinic, Jubilee Hills"],
      ["organization", "city", "Hyderabad"],
    ]);
    expect(byGroup.get("Composition/9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d")).toEqual([["prescription", "prescribedAt", "2026-08-14"]]);

    for (const c of parsed.candidates) {
      expect(c.confidence).toBe(1);
      expect("provenance" in c).toBe(false);
      expect(c.detectedText.length).toBeGreaterThan(0);
    }
  });

  it("turns lab Observations into diagnostic_result candidates with the analyte key resolved by LOINC", () => {
    const { bundle } = serializeDiagnosticReportRecord(loadCanonical<CanonicalDiagnosticReportRecord>("diagnostic-report-record"), { ig: "7.0" });
    const parsed = parseBundleToCandidates(bundle);
    const hba1c = parsed.candidates.filter((c) => c.groupKey === "Observation/bc2d3e4f-5a6b-4c7d-8e8f-9a0b1c2d3e4f").map((c) => [c.targetField, c.proposedValue]);
    expect(hba1c).toEqual([
      ["analyteLabelText", "HbA1c"],
      ["analyteKey", "hba1c"],
      ["enteredValueText", "6.8"],
      ["enteredUnit", "%"],
      ["referenceText", "4.0 - 5.6 %"],
    ]);
    const ferritin = parsed.candidates.filter((c) => c.groupKey === "Observation/cd3e4f5a-6b7c-4d8e-9f9a-0b1c2d3e4f5a").map((c) => [c.targetField, c.proposedValue]);
    expect(ferritin).toEqual([
      ["analyteLabelText", "Serum Ferritin"],
      ["enteredValueText", "12"],
      ["enteredUnit", "ng/mL"],
      ["comparator", "<"],
      ["referenceText", "15 - 150"],
    ]);
    const report = parsed.candidates.filter((c) => c.targetEntity === "diagnostic_report").map((c) => [c.targetField, c.proposedValue]);
    expect(report).toEqual([
      ["title", "HbA1c"],
      ["testedAt", "2026-08-10T03:30:00.000Z"],
      ["reportedAt", "2026-08-10T10:00:00.000Z"],
    ]);
    // A lab interpretation is never proposed (docs_v2/09 section 5).
    expect(parsed.candidates.some((c) => c.targetField === "interpretation")).toBe(false);
  });

  it("never throws on garbage and reports nothing for a non-bundle", () => {
    expect(parseBundleToCandidates(null)).toEqual({ candidates: [], unsupported: [], resourceCount: 0 });
    expect(parseBundleToCandidates({ resourceType: "Bundle", type: "collection", entry: [{ resource: { resourceType: "Binary" } }, {}] })).toEqual({
      candidates: [],
      unsupported: [{ resourceType: "Binary", id: null }],
      resourceCount: 1,
    });
  });
});
