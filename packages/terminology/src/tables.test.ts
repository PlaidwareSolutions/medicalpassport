import { REPORT_ANALYTES } from "@medpass/domain";
import { describe, expect, it } from "vitest";
import {
  ANALYTES_V1,
  ANALYTE_KEYS_V1,
  DOCUMENT_KINDS_V1,
  DOCUMENT_TYPES_V1,
  OBSERVATION_CONCEPTS_V1,
  OBSERVATION_CONCEPT_KEYS_V1,
  TERMINOLOGY_VERSION,
  findAnalyteByLoinc,
  getAnalyte,
  getDocumentType,
  getObservationConcept,
  listAnalytes,
  listDocumentTypes,
  listGate1bReviewItems,
  listObservationConcepts,
  listUnmapped,
} from "./index.js";

const LOINC_RE = /^\d{1,7}-\d$/;

describe("terminology tables (snapshot)", () => {
  it("is version v1", () => {
    expect(TERMINOLOGY_VERSION).toBe("v1");
  });

  it("analytes.v1 snapshot", () => {
    expect(ANALYTES_V1).toMatchSnapshot();
  });

  it("observation-concepts.v1 snapshot", () => {
    expect(OBSERVATION_CONCEPTS_V1).toMatchSnapshot();
  });

  it("document-types.v1 snapshot", () => {
    expect(DOCUMENT_TYPES_V1).toMatchSnapshot();
  });
});

describe("analytes.v1", () => {
  it("has exactly one entry per V1 analyte key in packages/domain report-analytes.ts", () => {
    const domainKeys = REPORT_ANALYTES.map((a) => a.id).sort();
    const tableKeys = ANALYTES_V1.map((a) => a.key).sort();
    expect(tableKeys).toEqual(domainKeys);
    expect([...ANALYTE_KEYS_V1].sort()).toEqual(domainKeys);
    expect(new Set(tableKeys).size).toBe(tableKeys.length);
  });

  it("mirrors the V1 label, group and printed unit exactly (the picker must say what the paper says)", () => {
    for (const v1 of REPORT_ANALYTES) {
      const entry = getAnalyte(v1.id);
      expect(entry, v1.id).toBeDefined();
      expect(entry?.display, v1.id).toBe(v1.label);
      expect(entry?.group, v1.id).toBe(v1.group);
      expect(entry?.canonicalUnitDisplay, v1.id).toBe(v1.unit);
    }
  });

  it("every LOINC code is well-formed and unique", () => {
    const codes = ANALYTES_V1.map((a) => a.loincCode).filter((c): c is string => c !== null);
    for (const c of codes) expect(c).toMatch(LOINC_RE);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("only the open entry lacks a canonical unit; everything else has a UCUM unit and display", () => {
    for (const a of ANALYTES_V1) {
      if (a.openEntry) {
        expect(a.canonicalUnit).toBeNull();
        expect(a.canonicalUnitDisplay).toBeNull();
        expect(a.allowedEnteredUnits).toEqual([]);
      } else {
        expect(a.canonicalUnit, a.key).toEqual(expect.any(String));
        expect(a.canonicalUnitDisplay, a.key).toEqual(expect.any(String));
      }
    }
  });

  it("uncoded entries always carry a reviewNote", () => {
    for (const a of ANALYTES_V1) {
      if (a.loincCode === null) expect(a.reviewNote, a.key).toEqual(expect.any(String));
    }
  });

  it("flags exactly the three docs/34 review items", () => {
    expect(listGate1bReviewItems().map((a) => a.key)).toEqual(["platelet_count", "urea", "t3_total"]);
    for (const a of listGate1bReviewItems()) expect(a.reviewNote).toContain("docs/34");
  });

  it("carries the well-known codes from the ticket", () => {
    const expected: Record<string, string> = {
      hba1c: "4548-4",
      fasting_glucose: "1558-6",
      creatinine: "2160-0",
      tsh: "3016-3",
      total_cholesterol: "2093-3",
      ldl_cholesterol: "13457-7",
      hdl_cholesterol: "2085-9",
      triglycerides: "2571-8",
      hemoglobin: "718-7",
      platelet_count: "777-3",
      sgpt_alt: "1742-6",
      sgot_ast: "1920-8",
      sodium: "2951-2",
      potassium: "2823-3",
      vitamin_d: "1989-3",
      vitamin_b12: "2132-9",
    };
    for (const [key, code] of Object.entries(expected)) {
      expect(getAnalyte(key)?.loincCode, key).toBe(code);
      expect(findAnalyteByLoinc(code)?.key).toBe(key);
    }
  });

  it("entered units never duplicate the canonical unit and have finite non-zero factors", () => {
    for (const a of ANALYTES_V1) {
      const seen = new Set<string>([a.canonicalUnit ?? ""]);
      for (const u of a.allowedEnteredUnits) {
        expect(seen.has(u.unit), `${a.key} ${u.unit}`).toBe(false);
        seen.add(u.unit);
        expect(Number.isFinite(u.factor) && u.factor !== 0, `${a.key} ${u.unit}`).toBe(true);
        if (u.offset !== undefined) expect(Number.isFinite(u.offset)).toBe(true);
      }
    }
  });

  it("lookups", () => {
    expect(listAnalytes()).toBe(ANALYTES_V1);
    expect(getAnalyte("nope")).toBeUndefined();
    expect(getAnalyte("hba1c")?.canonicalUnit).toBe("%");
  });
});

describe("observation-concepts.v1", () => {
  it("covers every ObservationConcept from docs_v2/04 §5.2 exactly once", () => {
    const docKeys = [
      "blood_pressure",
      "heart_rate",
      "blood_glucose",
      "body_weight",
      "body_height",
      "bmi",
      "spo2",
      "body_temperature",
      "respiratory_rate",
      "inr",
      "peak_flow",
      "pain_score",
      "insulin_dose",
      "fluid_intake",
      "fluid_output",
      "waist_circumference",
      "steps",
      "sleep_hours",
      "other",
    ].sort();
    expect(OBSERVATION_CONCEPTS_V1.map((c) => c.key).sort()).toEqual(docKeys);
    expect([...OBSERVATION_CONCEPT_KEYS_V1].sort()).toEqual(docKeys);
  });

  it("carries the vital-sign codes from the ticket", () => {
    const expected: Record<string, string> = {
      blood_pressure: "85354-9",
      heart_rate: "8867-4",
      spo2: "2708-6",
      body_temperature: "8310-5",
      body_weight: "29463-7",
      body_height: "8302-2",
      bmi: "39156-5",
      respiratory_rate: "9279-1",
      blood_glucose: "2339-0",
      inr: "6301-6",
      peak_flow: "19935-8",
    };
    for (const [key, code] of Object.entries(expected)) {
      expect(getObservationConcept(key)?.loincCode, key).toBe(code);
    }
    expect(getObservationConcept("spo2")?.additionalLoincCodes).toEqual(["59408-5"]);
  });

  it("blood pressure is the only two-value concept and carries systolic/diastolic component codes", () => {
    const two = OBSERVATION_CONCEPTS_V1.filter((c) => c.hasTwoValues);
    expect(two.map((c) => c.key)).toEqual(["blood_pressure"]);
    const bp = getObservationConcept("blood_pressure");
    expect(bp?.components?.map((c) => [c.slot, c.loincCode])).toEqual([
      ["valueNumeric", "8480-6"],
      ["valueNumeric2", "8462-4"],
    ]);
    for (const c of OBSERVATION_CONCEPTS_V1) {
      if (!c.hasTwoValues) expect(c.components, c.key).toBeNull();
      else expect(c.components?.length, c.key).toBe(2);
    }
  });

  it("all LOINC codes (primary, additional, component) are well-formed", () => {
    for (const c of OBSERVATION_CONCEPTS_V1) {
      if (c.loincCode !== null) expect(c.loincCode, c.key).toMatch(LOINC_RE);
      for (const extra of c.additionalLoincCodes) expect(extra, c.key).toMatch(LOINC_RE);
      for (const comp of c.components ?? []) {
        if (comp.loincCode !== null) expect(comp.loincCode, `${c.key}/${comp.slot}`).toMatch(LOINC_RE);
      }
    }
  });

  it("plausibility ranges are sane: finite, min < max, non-negative, and never a clinical threshold", () => {
    for (const c of OBSERVATION_CONCEPTS_V1) {
      if (c.openEntry) {
        expect(c.plausibility).toBeNull();
        continue;
      }
      const r = c.plausibility;
      expect(r, c.key).not.toBeNull();
      if (!r) continue;
      expect(Number.isFinite(r.min) && Number.isFinite(r.max), c.key).toBe(true);
      expect(r.min, c.key).toBeLessThan(r.max);
      expect(r.min, c.key).toBeGreaterThanOrEqual(0);
      for (const comp of c.components ?? []) {
        expect(comp.plausibility.min, `${c.key}/${comp.slot}`).toBeLessThan(comp.plausibility.max);
        expect(comp.plausibility.min, `${c.key}/${comp.slot}`).toBeGreaterThanOrEqual(0);
      }
    }
    // Percent-bounded and score-bounded concepts use their physical bounds, nothing tighter.
    expect(getObservationConcept("spo2")?.plausibility).toEqual({ min: 0, max: 100 });
    expect(getObservationConcept("pain_score")?.plausibility).toEqual({ min: 0, max: 10 });
    expect(getObservationConcept("sleep_hours")?.plausibility).toEqual({ min: 0, max: 24 });
    // Wide enough that no normal or abnormal human reading is rejected.
    expect(getObservationConcept("blood_glucose")?.plausibility).toEqual({ min: 10, max: 1000 });
    expect(getObservationConcept("body_temperature")?.plausibility).toEqual({ min: 25, max: 45 });
    expect(getObservationConcept("heart_rate")?.plausibility).toEqual({ min: 20, max: 300 });
  });

  it("canonical units match the docs_v2/04 §5.2 unit list", () => {
    const expected: Record<string, string> = {
      blood_pressure: "mmHg",
      heart_rate: "bpm",
      blood_glucose: "mg/dL",
      body_weight: "kg",
      body_height: "cm",
      spo2: "%",
      body_temperature: "°C",
      respiratory_rate: "/min",
      inr: "ratio",
      peak_flow: "L/min",
      pain_score: "0–10",
      insulin_dose: "IU",
      fluid_intake: "mL",
      fluid_output: "mL",
    };
    for (const [key, unit] of Object.entries(expected)) {
      expect(getObservationConcept(key)?.canonicalUnitDisplay, key).toBe(unit);
    }
    expect(listObservationConcepts()).toBe(OBSERVATION_CONCEPTS_V1);
  });
});

describe("document-types.v1", () => {
  it("covers the V1 DocumentKind enum plus the V2 additions exactly once", () => {
    const v1 = ["prescription", "strip", "box", "bottle", "discharge_summary", "lab_report", "scan_report", "other"];
    const v2 = ["consultation_note", "vaccination_record", "referral", "insurance", "invoice", "imaging_film"];
    expect(DOCUMENT_TYPES_V1.map((d) => d.key).sort()).toEqual([...v1, ...v2].sort());
    expect([...DOCUMENT_KINDS_V1].sort()).toEqual([...v1, ...v2].sort());
    expect(listDocumentTypes()).toBe(DOCUMENT_TYPES_V1);
  });

  it("carries the standard LOINC document codes", () => {
    expect(getDocumentType("discharge_summary")?.loincCode).toBe("18842-5");
    expect(getDocumentType("prescription")?.loincCode).toBe("57833-6");
    expect(getDocumentType("lab_report")?.loincCode).toBe("11502-2");
    expect(getDocumentType("scan_report")?.loincCode).toBe("18748-4");
    expect(getDocumentType("consultation_note")?.loincCode).toBe("11488-4");
    expect(getDocumentType("vaccination_record")?.loincCode).toBe("11369-6");
    for (const d of DOCUMENT_TYPES_V1) {
      if (d.loincCode !== null) expect(d.loincCode, d.key).toMatch(LOINC_RE);
      if (d.intentionallyUnmapped) expect(d.loincCode, d.key).toBeNull();
    }
  });
});

describe("listUnmapped (Gate 1b worklist)", () => {
  it("is explicit: exactly these entries lack a primary code", () => {
    const rows = listUnmapped().map((u) => `${u.kind}:${u.key}${u.intentional ? " (intentional)" : ""}`);
    expect(rows).toEqual([
      "analyte:post_prandial_glucose",
      "analyte:urea",
      "analyte:esr",
      "analyte:other (intentional)",
      "observation_concept:insulin_dose",
      "observation_concept:fluid_intake",
      "observation_concept:fluid_output",
      "observation_concept:waist_circumference",
      "observation_concept:steps",
      "observation_concept:sleep_hours",
      "observation_concept:other (intentional)",
      "document_type:strip (intentional)",
      "document_type:box (intentional)",
      "document_type:bottle (intentional)",
      "document_type:other (intentional)",
      "document_type:insurance (intentional)",
      "document_type:invoice (intentional)",
      "document_type:imaging_film",
    ]);
  });

  it("every non-intentional unmapped entry has a reviewNote naming candidates", () => {
    for (const u of listUnmapped()) {
      expect(u.reviewNote, `${u.kind}:${u.key}`).toEqual(expect.any(String));
    }
  });

  it("snapshot", () => {
    expect(listUnmapped()).toMatchSnapshot();
  });
});
