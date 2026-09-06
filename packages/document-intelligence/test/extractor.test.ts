import { afterAll, describe, expect, it } from "vitest";
import {
  DETERMINISTIC_EXTRACTOR,
  DeterministicExtractor,
  MATCH_QUALITY,
  NEVER_AUTO_PROPOSED,
  assembleLines,
  extractDeterministically,
  findDates,
  isValidSlotPattern,
  parseLabRow,
  validateCandidateDraft,
  type ClassificationResult,
  type DocumentKind,
  type ExtractionCandidateDraft,
} from "../src/index.js";
import { DISCHARGE_SUMMARY_LINES, LAB_REPORT_LINES, PRESCRIPTION_LINES } from "./corpus/synthetic.js";
import { catalogMatcher, find, findAll, ocrDocument, pdfDocument, textDocument, wordsFromLines } from "./helpers.js";

const matcher = catalogMatcher([
  { id: "prod-glycomet", names: ["Glycomet", "Glycomet-SR"] },
  { id: "prod-amlong", names: ["Amlong"] },
  { id: "prod-omez", names: ["Omez"] },
  { id: "prod-ecosprin", names: ["Ecosprin"] },
  { id: "prod-short", names: ["OD", "Ab"] },
]);

function classification(kind: DocumentKind): ClassificationResult {
  return { kind, confidence: 0.9, classifiedBy: "deterministic", signals: [] };
}

function run(lines: string[], kind: DocumentKind, opts: { words?: boolean; pdf?: boolean; confidence?: number } = {}) {
  const document = opts.pdf ? pdfDocument(lines) : opts.words ? ocrDocument(lines, opts.confidence ?? 0.95) : textDocument(lines);
  return extractDeterministically({ document, classification: classification(kind), catalogMatcher: matcher });
}

/** Expected (entity, field, value) triples for the accuracy report. */
const PRESCRIPTION_EXPECTED: Array<[string, string, unknown]> = [
  ["prescription", "prescribedAt", "2026-08-12"],
  ["prescription", "followUpOn", "2026-09-12"],
  ["practitioner", "displayName", "A. Verma"],
  ["practitioner", "registrationNumber", "TSMC/12345"],
  ["practitioner", "speciality", "General Physician"],
  ["organization", "displayName", "Sunrise Clinic, Banjara Hills, Hyderabad"],
  ["medication", "brandName", { productId: "prod-glycomet", label: "Glycomet" }],
  ["medication", "brandName", { productId: "prod-amlong", label: "Amlong" }],
  ["medication", "brandName", { productId: "prod-omez", label: "Omez" }],
  ["medication", "strengthLabel", { value: "500", unit: "mg" }],
  ["medication", "strengthLabel", { value: "5", unit: "mg" }],
  ["medication", "strengthLabel", { value: "20", unit: "mg" }],
  ["medication", "frequency", { code: "PATTERN", pattern: "1-0-1" }],
  ["medication", "frequency", { code: "OD" }],
  ["medication", "frequency", { code: "PATTERN", pattern: "1-0-0" }],
  ["medication", "foodInstruction", "after"],
  ["medication", "foodInstruction", "before"],
  ["medication", "foodInstruction", "before"],
  ["medication", "durationDays", 30],
  ["medication", "durationDays", 14],
  ["medication", "form", "tablet"],
  ["medication", "form", "capsule"],
];

const LAB_EXPECTED: Array<[string, string, unknown]> = [
  ["diagnostic_report", "specimenCollectedAt", "2026-08-10"],
  ["diagnostic_report", "reportedAt", "2026-08-11"],
  ["diagnostic_report", "labName", "Precision Diagnostics Laboratory, Secunderabad"],
  ["practitioner", "displayName", "S. Rao"],
  ["diagnostic_result", "analyteLabelText", "Haemoglobin"],
  ["diagnostic_result", "enteredValueText", "13.2"],
  ["diagnostic_result", "enteredUnit", "g/dL"],
  ["diagnostic_result", "referenceText", "13.0 - 17.0"],
  ["diagnostic_result", "analyteLabelText", "Total WBC Count"],
  ["diagnostic_result", "enteredValueText", "7800"],
  ["diagnostic_result", "enteredUnit", "cells/cumm"],
  ["diagnostic_result", "analyteLabelText", "Platelet Count"],
  ["diagnostic_result", "enteredValueText", "2,50,000"],
  ["diagnostic_result", "analyteLabelText", "HbA1c"],
  ["diagnostic_result", "enteredValueText", "5.8"],
  ["diagnostic_result", "enteredUnit", "%"],
  ["diagnostic_result", "analyteLabelText", "Fasting Glucose"],
  ["diagnostic_result", "enteredUnit", "mg/dL"],
  ["diagnostic_result", "referenceText", "70 - 100"],
  ["diagnostic_result", "analyteLabelText", "Vitamin D"],
  ["diagnostic_result", "comparator", "<"],
  ["diagnostic_result", "enteredValueText", "10"],
  ["diagnostic_result", "enteredUnit", "ng/mL"],
];

const accuracy: Array<{ fixture: string; hit: number; total: number }> = [];

function scoreExpected(fixture: string, drafts: ExtractionCandidateDraft[], expected: Array<[string, string, unknown]>) {
  const pool = [...drafts];
  let hit = 0;
  for (const [entity, field, value] of expected) {
    const idx = pool.findIndex((d) => d.targetEntity === entity && d.targetField === field && JSON.stringify(d.proposedValue) === JSON.stringify(value));
    if (idx >= 0) {
      hit += 1;
      pool.splice(idx, 1);
    }
  }
  accuracy.push({ fixture, hit, total: expected.length });
  return { hit, total: expected.length, missed: expected.filter(([e, f, v]) => !drafts.some((d) => d.targetEntity === e && d.targetField === f && JSON.stringify(d.proposedValue) === JSON.stringify(v))) };
}

afterAll(() => {
  const hit = accuracy.reduce((s, a) => s + a.hit, 0);
  const total = accuracy.reduce((s, a) => s + a.total, 0);
  const detail = accuracy.map((a) => `${a.fixture}: ${a.hit}/${a.total}`).join(", ");
  console.info(`[extractor accuracy] ${hit}/${total} expected fields found (${((100 * hit) / Math.max(1, total)).toFixed(1)}%) — ${detail}`);
});

describe("DeterministicExtractor — synthetic prescription", () => {
  const drafts = run(PRESCRIPTION_LINES, "prescription");

  it("finds every expected field with the expected value", () => {
    const { hit, total, missed } = scoreExpected("prescription", drafts, PRESCRIPTION_EXPECTED);
    expect(missed).toEqual([]);
    expect(hit).toBe(total);
  });

  it("every draft validates against the target catalogue", () => {
    for (const d of drafts) {
      const v = validateCandidateDraft(d);
      expect(v.ok, `${d.targetEntity}.${d.targetField}: ${!v.ok ? v.reasons.join("; ") : ""}`).toBe(true);
    }
  });

  it("stamps the extractor identity and the page on every draft", () => {
    for (const d of drafts) {
      expect(d.extractor).toEqual(DETERMINISTIC_EXTRACTOR);
      expect(d.pageNumber).toBe(1);
      expect(d.modelProvenance).toBeUndefined();
    }
  });

  it("keeps the source line verbatim as detectedText", () => {
    expect(find(drafts, "prescription", "prescribedAt")?.detectedText).toBe("Date: 12/08/2026");
    expect(find(drafts, "practitioner", "registrationNumber")?.detectedText).toBe("Reg. No. TSMC/12345");
  });

  it("uses a labelled 'Date:' line with higher confidence than a bare date", () => {
    const labelled = find(run(["Date: 12/08/2026", "Rx"], "prescription"), "prescription", "prescribedAt");
    const bare = find(run(["12/08/2026", "Rx"], "prescription"), "prescription", "prescribedAt");
    expect(labelled?.proposedValue).toBe("2026-08-12");
    expect(bare?.proposedValue).toBe("2026-08-12");
    expect(labelled!.confidence).toBeGreaterThan(bare!.confidence);
  });

  it("never proposes a date of birth or review date as prescribedAt", () => {
    const drafts = run(["DOB: 01/01/1970", "Review on 12/09/2026", "Rx"], "prescription");
    expect(find(drafts, "prescription", "prescribedAt")).toBeUndefined();
    expect(find(drafts, "prescription", "followUpOn")?.proposedValue).toBe("2026-09-12");
  });

  it("keeps exactly one candidate per single-slot field (prescribedAt, practitioner, organization)", () => {
    expect(findAll(drafts, "prescription", "prescribedAt")).toHaveLength(1);
    expect(findAll(drafts, "practitioner", "displayName")).toHaveLength(1);
    expect(findAll(drafts, "organization", "displayName")).toHaveLength(1);
  });

  it("groups all fields of a medicine line — including its continuation line — under one groupKey", () => {
    const omez = drafts.find((d) => d.targetField === "brandName" && (d.proposedValue as { productId: string }).productId === "prod-omez");
    expect(omez?.groupKey).toBeDefined();
    const group = drafts.filter((d) => d.groupKey === omez?.groupKey).map((d) => d.targetField).sort();
    expect(group).toEqual(["brandName", "durationDays", "foodInstruction", "form", "frequency", "strengthLabel"]);
    expect(drafts.find((d) => d.groupKey === omez?.groupKey && d.targetField === "durationDays")?.detectedText).toBe("1-0-0 empty stomach for 2 weeks");
  });

  it("never proposes doseQuantity, however clearly a dose is printed", () => {
    const drafts = run(["Tab. Dolo 650 mg 2 tablets TDS for 3 days", "1 tab OD"], "prescription");
    expect(find(drafts, "medication", "doseQuantity")).toBeUndefined();
    for (const [entity, fields] of Object.entries(NEVER_AUTO_PROPOSED)) {
      for (const field of fields ?? []) expect(find(drafts, entity, field)).toBeUndefined();
    }
  });

  it("does not match catalog names shorter than three characters (worker rule kept)", () => {
    const drafts = run(["Tab. Something 1 OD", "Ab initio"], "prescription");
    expect(findAll(drafts, "medication", "brandName").map((d) => (d.proposedValue as { productId: string }).productId)).not.toContain("prod-short");
  });

  it("only matches frequency abbreviations on word boundaries", () => {
    const drafts = run(["Tab. Dolo 650 mg", "Pain in abdomen", "Past history: nil"], "prescription");
    expect(findAll(drafts, "medication", "frequency")).toEqual([]);
  });

  it("rejects an all-zero slot pattern", () => {
    expect(isValidSlotPattern("0-0-0")).toBe(false);
    expect(isValidSlotPattern("1-0")).toBe(false);
    expect(isValidSlotPattern("0.5-0-0.5")).toBe(true);
    expect(find(run(["Tab. X 500 mg 0-0-0"], "prescription"), "medication", "frequency")).toBeUndefined();
  });

  it("does not read a lab unit like mg/dL as a strength", () => {
    const drafts = run(["Tab. Dolo 650 mg/dL"], "prescription");
    expect(find(drafts, "medication", "strengthLabel")).toBeUndefined();
  });

  it("works without a catalog matcher — everything but brandName is still proposed", () => {
    const drafts = extractDeterministically({ document: textDocument(PRESCRIPTION_LINES), classification: classification("prescription") });
    expect(findAll(drafts, "medication", "brandName")).toEqual([]);
    expect(findAll(drafts, "medication", "frequency").length).toBeGreaterThanOrEqual(3);
  });

  it("produces no candidates for unrelated text or empty pages", () => {
    expect(run(["Hello there", "Nothing clinical"], "prescription")).toEqual([]);
    expect(run([], "prescription")).toEqual([]);
    expect(extractDeterministically({ document: { mimeType: "image/jpeg", pages: [] } })).toEqual([]);
  });

  it("the class wrapper delegates to the same function", async () => {
    const extractor = new DeterministicExtractor();
    const viaClass = await extractor.extract({ document: textDocument(PRESCRIPTION_LINES), classification: classification("prescription"), catalogMatcher: matcher });
    expect(viaClass).toEqual(drafts);
    expect(extractor.identity).toEqual(DETERMINISTIC_EXTRACTOR);
  });
});

describe("DeterministicExtractor — synthetic laboratory report", () => {
  const drafts = run(LAB_REPORT_LINES, "laboratory_report", { words: true });

  it("finds every expected field with the expected value", () => {
    const { hit, total, missed } = scoreExpected("laboratory_report", drafts, LAB_EXPECTED);
    expect(missed).toEqual([]);
    expect(hit).toBe(total);
  });

  it("every draft validates against the target catalogue", () => {
    for (const d of drafts) {
      const v = validateCandidateDraft(d);
      expect(v.ok, `${d.targetEntity}.${d.targetField}: ${!v.ok ? v.reasons.join("; ") : ""}`).toBe(true);
    }
  });

  it("never proposes an interpretation even when the lab printed H/L flags", () => {
    expect(findAll(drafts, "diagnostic_result", "interpretation")).toEqual([]);
    expect(drafts.some((d) => d.detectedText.endsWith(" H"))).toBe(true); // the flag was on the page
  });

  it("keeps the unit as its own candidate (H-35) — never converted", () => {
    const glucose = drafts.filter((d) => d.detectedText.startsWith("Fasting Glucose"));
    expect(find(glucose, "diagnostic_result", "enteredUnit")?.proposedValue).toBe("mg/dL");
    expect(find(glucose, "diagnostic_result", "enteredValueText")?.proposedValue).toBe("96");
  });

  it("does not turn header, title, or date lines into result rows", () => {
    const labels = findAll(drafts, "diagnostic_result", "analyteLabelText").map((d) => d.proposedValue);
    expect(labels).not.toContain("Test Name  Result  Unit  Reference Range");
    expect(labels).not.toContain("Complete Blood Count");
    expect(labels.some((l) => String(l).includes("collected"))).toBe(false);
  });

  it("groups the fields of one row under one groupKey", () => {
    const hb = drafts.filter((d) => d.detectedText.startsWith("Haemoglobin"));
    expect(new Set(hb.map((d) => d.groupKey)).size).toBe(1);
    expect(hb.map((d) => d.targetField).sort()).toEqual(["analyteLabelText", "enteredUnit", "enteredValueText", "referenceText"]);
  });

  it("parseLabRow rejects prescription-style and free-text lines", () => {
    expect(parseLabRow("Tab. Dolo 650 mg")).toBeNull();
    expect(parseLabRow("Age 54 years")).toBeNull();
    expect(parseLabRow("Amlong 5 mg OD")).toBeNull();
    expect(parseLabRow("Sample collected: 10/08/2026")).toBeNull();
    expect(parseLabRow("Haemoglobin 13.2 g/dL")?.unit).toBe("g/dL");
    expect(parseLabRow("pH 7.4 7.35 - 7.45")?.reference).toBe("7.35 - 7.45");
  });
});

describe("DeterministicExtractor — synthetic discharge summary", () => {
  const drafts = run(DISCHARGE_SUMMARY_LINES, "discharge_summary");

  it("proposes the encounter admission/discharge dates as an inpatient encounter", () => {
    expect(find(drafts, "encounter", "startedAt")?.proposedValue).toBe("2026-08-01");
    expect(find(drafts, "encounter", "endedAt")?.proposedValue).toBe("2026-08-05");
    expect(find(drafts, "encounter", "kind")?.proposedValue).toBe("inpatient");
  });

  it("does not propose prescribedAt for a discharge summary", () => {
    expect(find(drafts, "prescription", "prescribedAt")).toBeUndefined();
  });

  it("still extracts the medicine lines (for the transition workflow, H-34) and the consultant", () => {
    expect(findAll(drafts, "medication", "brandName").map((d) => (d.proposedValue as { productId: string }).productId)).toContain("prod-ecosprin");
    expect(find(drafts, "practitioner", "displayName")?.proposedValue).toBe("P. Nair");
    expect(find(drafts, "organization", "displayName")?.proposedValue).toBe("Meadow Hospitals, Kukatpally");
  });
});

describe("DeterministicExtractor — confidence via combine(ocrWordConfidence, matchQuality)", () => {
  it("passes match quality through unchanged for a PDF text layer", () => {
    const drafts = run(["Date: 12/08/2026", "Tab. Glycomet 500 mg 1-0-1 after food"], "prescription", { pdf: true });
    expect(find(drafts, "prescription", "prescribedAt")?.confidence).toBe(MATCH_QUALITY.dateLabelled);
    expect(find(drafts, "medication", "brandName")?.confidence).toBe(MATCH_QUALITY.brandCatalog);
    expect(find(drafts, "medication", "frequency")?.confidence).toBe(MATCH_QUALITY.frequencyPattern);
    expect(find(drafts, "medication", "foodInstruction")?.confidence).toBe(MATCH_QUALITY.foodInstruction);
  });

  it("multiplies by the mean confidence of the cited words when word boxes exist", () => {
    const drafts = run(["Tab. Glycomet 500 mg 1-0-1 after food"], "prescription", { words: true, confidence: 0.8 });
    expect(find(drafts, "medication", "brandName")?.confidence).toBeCloseTo(0.8 * MATCH_QUALITY.brandCatalog, 4);
    expect(find(drafts, "medication", "frequency")?.confidence).toBeCloseTo(0.8 * MATCH_QUALITY.frequencyPattern, 4);
  });

  it("uses the default OCR text confidence when there are no word boxes", () => {
    const drafts = run(["Tab. Glycomet 500 mg"], "prescription");
    expect(find(drafts, "medication", "brandName")?.confidence).toBeCloseTo(0.9 * MATCH_QUALITY.brandCatalog, 4);
  });
});

describe("DeterministicExtractor — bounding boxes", () => {
  const lines = ["Tab. Glycomet 500 mg 1-0-1 after food x 30 days"];
  const words = wordsFromLines(lines);
  const drafts = run(lines, "prescription", { words: true });

  const wordBox = (text: string) => words.find((w) => w.text === text)!.box;

  it("covers exactly the matched words for a sub-line match", () => {
    const strength = find(drafts, "medication", "strengthLabel")!;
    const from = wordBox("500");
    const to = wordBox("mg");
    expect(strength.boundingBox).toBeDefined();
    expect(strength.boundingBox!.x).toBeCloseTo(from.x, 6);
    expect(strength.boundingBox!.x + strength.boundingBox!.w).toBeCloseTo(to.x + to.w, 6);
    expect(strength.boundingBox!.y).toBeCloseTo(from.y, 6);
    expect(strength.boundingBox!.h).toBeCloseTo(from.h, 6);
  });

  it("covers the brand word only for brandName", () => {
    const brand = find(drafts, "medication", "brandName")!;
    expect(brand.boundingBox).toEqual(wordBox("Glycomet"));
  });

  it("covers the duration phrase 'x 30 days'", () => {
    const duration = find(drafts, "medication", "durationDays")!;
    expect(duration.boundingBox!.x).toBeCloseTo(wordBox("x").x, 6);
    expect(duration.boundingBox!.x + duration.boundingBox!.w).toBeCloseTo(wordBox("days").x + wordBox("days").w, 6);
  });

  it("every box is normalized within the page", () => {
    for (const d of drafts) {
      const b = d.boundingBox!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1);
      expect(b.y + b.h).toBeLessThanOrEqual(1);
    }
  });

  it("omits the box (never guesses one) when a page has text but no word boxes", () => {
    for (const d of run(lines, "prescription")) expect(d.boundingBox).toBeUndefined();
  });

  it("rebuilds lines from word boxes alone and still cites boxes", () => {
    const doc = ocrDocument(["Date: 12/08/2026", "Tab. Amlong 5 mg OD"]);
    doc.pages[0]!.text = undefined;
    const lines = assembleLines(doc);
    expect(lines.map((l) => l.text)).toEqual(["Date: 12/08/2026", "Tab. Amlong 5 mg OD"]);
    const drafts = extractDeterministically({ document: doc, classification: classification("prescription"), catalogMatcher: matcher });
    expect(find(drafts, "prescription", "prescribedAt")?.boundingBox).toBeDefined();
    expect(find(drafts, "medication", "frequency")?.boundingBox).toBeDefined();
  });

  it("attaches candidates on page 2 to page 2 (H-36)", () => {
    const doc = {
      mimeType: "application/pdf",
      pdfTextLayer: true,
      pages: [
        { pageNumber: 1, text: "Sunrise Clinic\nDate: 12/08/2026" },
        { pageNumber: 2, text: "Tab. Amlong 5 mg OD" },
      ],
    };
    const drafts = extractDeterministically({ document: doc, classification: classification("prescription"), catalogMatcher: matcher });
    expect(find(drafts, "medication", "brandName")?.pageNumber).toBe(2);
    expect(find(drafts, "prescription", "prescribedAt")?.pageNumber).toBe(1);
  });
});

describe("findDates", () => {
  it.each([
    ["12/08/2026", "2026-08-12"],
    ["12-08-26", "2026-08-12"],
    ["3.8.2026", "2026-08-03"],
    ["12 Aug 2026", "2026-08-12"],
    ["12th August, 2026", "2026-08-12"],
    ["Aug 12, 2026", "2026-08-12"],
    ["2026-08-12", "2026-08-12"],
  ])("parses %s as %s", (raw, iso) => {
    expect(findDates(`Date: ${raw}`)[0]?.iso).toBe(iso);
  });

  it("skips impossible dates and slot patterns", () => {
    expect(findDates("31/02/2026")).toEqual([]);
    expect(findDates("Tab X 1-0-1")).toEqual([]);
  });
});
