import { describe, expect, it } from "vitest";
import {
  DeterministicClassifier,
  DeterministicExtractor,
  classifyThenExtract,
  type ClinicalExtractor,
  type DocumentClassifier,
  type ExtractionCandidateDraft,
  type ExtractionInput,
} from "../src/index.js";
import { LAB_REPORT_LINES, PRESCRIPTION_LINES } from "./corpus/synthetic.js";
import { catalogMatcher, find, findAll, textDocument } from "./helpers.js";

const matcher = catalogMatcher([{ id: "prod-glycomet", names: ["Glycomet"] }]);
const classifier = new DeterministicClassifier();
const extractor = new DeterministicExtractor();

const stubDraft = (over: Partial<ExtractionCandidateDraft>): ExtractionCandidateDraft => ({
  targetEntity: "medication",
  targetField: "frequency",
  pageNumber: 1,
  detectedText: "Tab. Glycomet 500 mg 1-0-1 after food x 30 days",
  proposedValue: { code: "PATTERN", pattern: "1-0-1" },
  confidence: 0.8,
  extractor: { name: "stub-extractor", version: "1" },
  ...over,
});

function stubExtractor(drafts: unknown[] | (() => never)): ClinicalExtractor {
  return {
    identity: { name: "stub-extractor", version: "1" },
    async extract(_input: ExtractionInput) {
      if (typeof drafts === "function") drafts();
      return drafts as ExtractionCandidateDraft[];
    },
  };
}

describe("classifyThenExtract — end to end with the deterministic pair", () => {
  it("classifies a prescription and returns validated medication candidates", async () => {
    const result = await classifyThenExtract(textDocument(PRESCRIPTION_LINES), { classifier, extractor, catalogMatcher: matcher });
    expect(result.classification.kind).toBe("prescription");
    expect(result.kind).toBe("prescription");
    expect(result.dropped).toEqual([]);
    expect(find(result.candidates, "medication", "brandName")?.proposedValue).toEqual({ productId: "prod-glycomet", label: "Glycomet" });
    expect(find(result.candidates, "prescription", "prescribedAt")?.proposedValue).toBe("2026-08-12");
  });

  it("classifies a lab report and returns result rows", async () => {
    const result = await classifyThenExtract(textDocument(LAB_REPORT_LINES), { classifier, extractor });
    expect(result.classification.kind).toBe("laboratory_report");
    expect(findAll(result.candidates, "diagnostic_result", "analyteLabelText").length).toBeGreaterThanOrEqual(5);
    expect(result.dropped).toEqual([]);
  });

  it("the user's chosen kind always wins over the classifier (docs_v2/09 §4)", async () => {
    const result = await classifyThenExtract(textDocument(LAB_REPORT_LINES, { kind: "other" }), { classifier, extractor });
    expect(result.classification.kind).toBe("laboratory_report"); // reported as-is for metrics
    expect(result.kind).toBe("other"); // but extraction ran as the user said
  });
});

describe("classifyThenExtract — guards on every candidate", () => {
  const doc = textDocument(PRESCRIPTION_LINES);

  it("drops a never-auto-proposed dose quantity, keeps the valid sibling", async () => {
    const result = await classifyThenExtract(doc, {
      classifier,
      extractor: stubExtractor([stubDraft({}), stubDraft({ targetField: "doseQuantity", proposedValue: 1 })]),
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]?.reasons).toEqual(["never_auto_proposed:medication.doseQuantity"]);
  });

  it("drops a lab interpretation", async () => {
    const result = await classifyThenExtract(doc, {
      classifier,
      extractor: stubExtractor([stubDraft({ targetEntity: "diagnostic_result", targetField: "interpretation", proposedValue: "High" })]),
    });
    expect(result.candidates).toEqual([]);
    expect(result.dropped[0]?.reasons).toEqual(["never_auto_proposed:diagnostic_result.interpretation"]);
  });

  it("drops unknown targets and invalid values with reasons", async () => {
    const result = await classifyThenExtract(doc, {
      classifier,
      extractor: stubExtractor([
        stubDraft({ targetEntity: "starship", targetField: "name", proposedValue: "x" }),
        stubDraft({ targetEntity: "prescription", targetField: "prescribedAt", proposedValue: "12/08/2026", detectedText: "Date: 12/08/2026" }),
      ]),
    });
    expect(result.candidates).toEqual([]);
    expect(result.dropped.map((d) => d.reasons[0])).toEqual([
      "unknown_target:starship.name",
      expect.stringMatching(/^value:prescription\.prescribedAt:/),
    ]);
  });

  it("drops a candidate whose detectedText is not on the cited page (H-37 hallucinated medicine)", async () => {
    const result = await classifyThenExtract(doc, {
      classifier,
      extractor: stubExtractor([stubDraft({ detectedText: "Tab. Imaginol 10 mg OD" })]),
    });
    expect(result.candidates).toEqual([]);
    expect(result.dropped[0]?.reasons).toEqual(["detected_text_not_on_page"]);
  });

  it("matches detectedText tolerant of case, spacing and punctuation (OCR noise)", async () => {
    const result = await classifyThenExtract(doc, {
      classifier,
      extractor: stubExtractor([stubDraft({ detectedText: "TAB GLYCOMET 500MG 1-0-1 AFTER FOOD X 30 DAYS" })]),
    });
    expect(result.candidates).toHaveLength(1);
  });

  it("drops a candidate citing a page that is not in the document (H-36)", async () => {
    const result = await classifyThenExtract(doc, { classifier, extractor: stubExtractor([stubDraft({ pageNumber: 7 })]) });
    expect(result.dropped[0]?.reasons).toEqual(["page_not_in_document:7"]);
  });

  it("drops garbage entries without throwing", async () => {
    const result = await classifyThenExtract(doc, { classifier, extractor: stubExtractor([null, 42, "x", {}]) });
    expect(result.candidates).toEqual([]);
    expect(result.dropped).toHaveLength(4);
  });

  it("never throws when the extractor itself fails — classification still stands", async () => {
    const boom = stubExtractor(() => {
      throw new RangeError("bad page");
    });
    const result = await classifyThenExtract(doc, { classifier, extractor: boom });
    expect(result.classification.kind).toBe("prescription");
    expect(result.candidates).toEqual([]);
    expect(result.dropped[0]?.reasons).toEqual(["extractor_failed:RangeError"]);
  });

  it("passes the effective classification and catalog matcher to the extractor", async () => {
    let seen: ExtractionInput | undefined;
    const spy: ClinicalExtractor = {
      identity: { name: "spy", version: "1" },
      async extract(input) {
        seen = input;
        return [];
      },
    };
    const stubClassifier: DocumentClassifier = {
      async classify() {
        return { kind: "invoice", confidence: 0.7, classifiedBy: "model", signals: [] };
      },
    };
    await classifyThenExtract(textDocument(PRESCRIPTION_LINES, { kind: "prescription" }), { classifier: stubClassifier, extractor: spy, catalogMatcher: matcher });
    expect(seen?.classification?.kind).toBe("prescription");
    expect(seen?.classification?.signals[0]).toBe("user-selected-kind");
    expect(seen?.catalogMatcher).toBe(matcher);
  });
});
