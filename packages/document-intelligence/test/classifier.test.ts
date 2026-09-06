import { afterAll, describe, expect, it } from "vitest";
import { CONFIDENCE_THRESHOLDS, DOCUMENT_KINDS, DeterministicClassifier, classifyDeterministically, confidenceFor, scoreKinds } from "../src/index.js";
import { CLASSIFIER_CORPUS, DISCHARGE_LOOKS_LIKE_RX_LINES } from "./corpus/synthetic.js";
import { ocrDocument, textDocument } from "./helpers.js";

const classifier = new DeterministicClassifier();

describe("DeterministicClassifier — corpus", () => {
  const results: Array<{ id: string; expected: string; got: string; confidence: number }> = [];

  it.each(CLASSIFIER_CORPUS)("classifies $id as $kind", async (fixture) => {
    const result = await classifier.classify(textDocument(fixture.lines));
    results.push({ id: fixture.id, expected: fixture.kind, got: result.kind, confidence: result.confidence });
    expect(result.kind).toBe(fixture.kind);
    expect(result.classifiedBy).toBe("deterministic");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("covers every DocumentKind at least once", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(CLASSIFIER_CORPUS.some((f) => f.kind === kind), `no fixture for ${kind}`).toBe(true);
    }
  });

  it("puts every non-'other' fixture at least in the 'please check' bucket", async () => {
    for (const fixture of CLASSIFIER_CORPUS.filter((f) => f.kind !== "other")) {
      const result = await classifier.classify(textDocument(fixture.lines));
      expect(result.confidence, fixture.id).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLDS.check);
    }
  });

  afterAll(() => {
    const correct = results.filter((r) => r.expected === r.got).length;
    const perKind = new Map<string, { n: number; ok: number }>();
    for (const r of results) {
      const e = perKind.get(r.expected) ?? { n: 0, ok: 0 };
      e.n += 1;
      if (r.expected === r.got) e.ok += 1;
      perKind.set(r.expected, e);
    }
    const lines = [...perKind.entries()].map(([k, v]) => `${k}: ${v.ok}/${v.n}`).join(", ");
    console.info(`[classifier accuracy] ${correct}/${results.length} (${((100 * correct) / Math.max(1, results.length)).toFixed(1)}%) — ${lines}`);
  });
});

describe("DeterministicClassifier — H-34 discharge summary vs prescription", () => {
  it("never classifies a discharge summary as a prescription even when it lists medicines like an Rx", () => {
    const result = classifyDeterministically(textDocument(DISCHARGE_LOOKS_LIKE_RX_LINES));
    expect(result.kind).toBe("discharge_summary");
    const scored = scoreKinds(textDocument(DISCHARGE_LOOKS_LIKE_RX_LINES));
    const rx = scored.find((s) => s.kind === "prescription");
    const discharge = scored.find((s) => s.kind === "discharge_summary");
    // The prescription vocabulary genuinely outscores the single discharge header —
    // the H-34 rule is what flips it.
    expect(rx!.score).toBeGreaterThan(discharge!.score);
    expect(result.signals).toContain("rule:H-34-discharge-over-prescription");
  });

  it("resolves an exact tie in favour of discharge_summary", () => {
    // 2 points each: "Rx" (2) vs "date of admission" (2).
    const result = classifyDeterministically(textDocument(["Rx", "Date of admission: 1/8/26"]));
    expect(result.kind).toBe("discharge_summary");
    expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLDS.check); // a tie halves confidence
  });

  it("still classifies a plain prescription as prescription", () => {
    const result = classifyDeterministically(textDocument(["Rx", "Tab. Dolo 650 SOS", "Advice: rest"]));
    expect(result.kind).toBe("prescription");
  });
});

describe("DeterministicClassifier — edge cases", () => {
  it("returns other with low confidence for empty input", () => {
    const result = classifyDeterministically({ mimeType: "image/jpeg", pages: [{ pageNumber: 1, text: "" }] });
    expect(result).toEqual({ kind: "other", confidence: 0.2, classifiedBy: "deterministic", signals: ["no-signal"] });
  });

  it("returns other with low confidence when nothing matches", () => {
    const result = classifyDeterministically(textDocument(["Hello", "Nothing clinical here"]));
    expect(result.kind).toBe("other");
    expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLDS.check);
  });

  it("reads text from word boxes when a page has no text", () => {
    const doc = ocrDocument(["Haemoglobin 13.2 g/dL 13.0 - 17.0", "Specimen: blood"]);
    doc.pages[0]!.text = undefined;
    expect(classifyDeterministically(doc).kind).toBe("laboratory_report");
  });

  it("accepts Indian-English spellings (haemoglobin, centre, immunisation)", () => {
    expect(classifyDeterministically(textDocument(["Haemoglobin 12 g/dL"])).kind).toBe("laboratory_report");
    expect(classifyDeterministically(textDocument(["Immunisation card", "Vaccine: BCG", "Dose 1"])).kind).toBe("vaccination_record");
  });

  it("treats a short strength-only text without dates as medicine packaging", () => {
    const result = classifyDeterministically(textDocument(["Paracetamol 500 mg", "10 tablets"]));
    expect(result.kind).toBe("medicine_packaging");
    expect(result.signals).toContain("layout:short-with-strength-no-dates");
  });

  it("does not use the layout heuristic when another kind already has strong evidence (a short Rx is not a strip)", () => {
    const result = classifyDeterministically(textDocument(["Discharge Summary", "Tab. Ecosprin 75 mg OD"]));
    expect(result.kind).toBe("discharge_summary");
    expect(result.signals).not.toContain("layout:short-with-strength-no-dates");
  });

  it("does not use the layout heuristic once dates appear", () => {
    const result = classifyDeterministically(textDocument(["Paracetamol 500 mg", "Date: 12/08/2026"]));
    expect(result.signals).not.toContain("layout:short-with-strength-no-dates");
  });

  it("signals are static ids, never page content", () => {
    const result = classifyDeterministically(textDocument(["Haemoglobin 13.2 g/dL", "Patient: Someone Specific"]));
    for (const s of result.signals) expect(s).not.toMatch(/someone/i);
  });

  it("classification is stable across repeated calls (regex state does not leak)", () => {
    const doc = textDocument(["Rx", "Tab. Dolo 650 SOS"]);
    const a = classifyDeterministically(doc);
    const b = classifyDeterministically(doc);
    expect(b).toEqual(a);
  });
});

describe("confidenceFor", () => {
  it("grows with the winning score and is capped", () => {
    expect(confidenceFor(1, 0)).toBe(0.55);
    expect(confidenceFor(2, 0)).toBe(0.7);
    expect(confidenceFor(3, 0)).toBe(0.85);
    expect(confidenceFor(10, 0)).toBe(0.97);
  });
  it("halves on an exact tie", () => {
    expect(confidenceFor(4, 4)).toBe(0.485);
  });
  it("is zero without any signal", () => {
    expect(confidenceFor(0, 0)).toBe(0);
  });
});
