import type { DocumentInput, ExtractionCandidateDraft, OcrWord, PageInput } from "../src/index.js";

/**
 * Builds synthetic OCR word boxes for lines of text: line `i` sits at a fixed row, words are
 * laid out left-to-right with a width proportional to their length. Deterministic, so tests can
 * assert exact box coverage.
 */
export function wordsFromLines(lines: string[], confidence = 0.95): OcrWord[] {
  const words: OcrWord[] = [];
  const rowHeight = 0.03;
  lines.forEach((line, row) => {
    let x = 0.05;
    const y = 0.05 + row * rowHeight * 1.5;
    for (const token of line.split(/\s+/).filter(Boolean)) {
      const w = Math.min(0.3, 0.012 * token.length + 0.005);
      words.push({ text: token, confidence, box: { x, y, w, h: rowHeight } });
      x += w + 0.01;
    }
  });
  return words;
}

export function textDocument(lines: string[], extra: Partial<DocumentInput> = {}): DocumentInput {
  return { mimeType: "image/jpeg", pages: [{ pageNumber: 1, text: lines.join("\n") }], ...extra };
}

export function ocrDocument(lines: string[], confidence = 0.95, extra: Partial<DocumentInput> = {}): DocumentInput {
  const page: PageInput = { pageNumber: 1, text: lines.join("\n"), words: wordsFromLines(lines, confidence) };
  return { mimeType: "image/jpeg", pages: [page], ...extra };
}

export function pdfDocument(lines: string[]): DocumentInput {
  return { mimeType: "application/pdf", pdfTextLayer: true, pages: [{ pageNumber: 1, text: lines.join("\n") }] };
}

export function find(drafts: ExtractionCandidateDraft[], entity: string, field: string): ExtractionCandidateDraft | undefined {
  return drafts.find((d) => d.targetEntity === entity && d.targetField === field);
}

export function findAll(drafts: ExtractionCandidateDraft[], entity: string, field: string): ExtractionCandidateDraft[] {
  return drafts.filter((d) => d.targetEntity === entity && d.targetField === field);
}

/** Catalog matcher stand-in for the worker's medicationProduct + brand rows. */
export function catalogMatcher(products: Array<{ id: string; names: string[] }>) {
  return (line: string) => {
    const lower = line.toLowerCase();
    for (const p of products) {
      for (const name of p.names) {
        if (name.length < 3) continue;
        const at = lower.indexOf(name.toLowerCase());
        if (at >= 0) return { productId: p.id, label: p.names[0] ?? name, matchedText: line.slice(at, at + name.length) };
      }
    }
    return null;
  };
}
