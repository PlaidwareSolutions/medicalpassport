import { describe, expect, it } from "vitest";
import { combine, DEFAULT_TEXT_CONFIDENCE, extractDeterministically, MATCH_QUALITY, type DocumentInput } from "../src/index.js";
import { find, ocrDocument, textDocument } from "./helpers.js";

/**
 * Confidence policy, defect 5 of docs_v2/16 §3: OCR engine confidence must flow into
 * candidate confidence. Three sources, in order of preference — the cited words' own
 * confidence, the page-level confidence the engine reported, and only then the fixed default.
 */
describe("OCR confidence flows into candidate confidence", () => {
  const lines = ["Date: 12/03/2026", "Tab Glycomet 500mg 1-0-1 after food"];

  it("word confidence × match quality when word boxes back the line", () => {
    const drafts = extractDeterministically({ document: ocrDocument(lines, 0.6) });
    const frequency = find(drafts, "medication", "frequency");
    expect(frequency?.confidence).toBe(combine(0.6, MATCH_QUALITY.frequencyPattern));
  });

  it("page confidence × match quality when the page has text but no word boxes", () => {
    const document: DocumentInput = { mimeType: "image/jpeg", pages: [{ pageNumber: 1, text: lines.join("\n"), confidence: 0.55 }] };
    const drafts = extractDeterministically({ document });
    const frequency = find(drafts, "medication", "frequency");
    expect(frequency?.confidence).toBe(combine(0.55, MATCH_QUALITY.frequencyPattern));
    // A blurry page lands in the "please check" / "other things we saw" buckets, never pre-selected.
    expect(frequency!.confidence).toBeLessThan(0.6);
  });

  it("each page keeps its own confidence in a multi-page document", () => {
    const document: DocumentInput = {
      mimeType: "image/jpeg",
      pages: [
        { pageNumber: 1, text: "Tab Glycomet 500mg 1-0-1 after food", confidence: 0.95 },
        { pageNumber: 2, text: "Tab Ecosprin 75mg 0-0-1 after food", confidence: 0.4 },
      ],
    };
    const drafts = extractDeterministically({ document, classification: { kind: "prescription", confidence: 1, classifiedBy: "deterministic", signals: [] } });
    const page1 = drafts.filter((d) => d.pageNumber === 1 && d.targetField === "frequency")[0];
    const page2 = drafts.filter((d) => d.pageNumber === 2 && d.targetField === "frequency")[0];
    expect(page1?.confidence).toBe(combine(0.95, MATCH_QUALITY.frequencyPattern));
    expect(page2?.confidence).toBe(combine(0.4, MATCH_QUALITY.frequencyPattern));
  });

  it("falls back to the fixed default only when the engine reported nothing", () => {
    const drafts = extractDeterministically({ document: textDocument(lines) });
    expect(find(drafts, "medication", "frequency")?.confidence).toBe(combine(DEFAULT_TEXT_CONFIDENCE.ocrText, MATCH_QUALITY.frequencyPattern));
  });

  it("a PDF text layer is exact: page confidence is ignored and match quality passes through", () => {
    const document: DocumentInput = { mimeType: "application/pdf", pdfTextLayer: true, pages: [{ pageNumber: 1, text: lines.join("\n"), confidence: 0.3 }] };
    const drafts = extractDeterministically({ document });
    expect(find(drafts, "medication", "frequency")?.confidence).toBe(combine(1, MATCH_QUALITY.frequencyPattern));
  });
});
