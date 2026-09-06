/**
 * Line assembly and bounding-box helpers shared by extractors.
 *
 * A `SourceLine` keeps, for each whitespace token of its text, the OCR word it came from (when
 * word boxes are available), so a rule that matched characters [start, end) of the line can
 * cite the union box of exactly those words (docs_v2/09 §1 rule 2, H-37).
 */
import type { BoundingBox, DocumentInput, OcrWord, PageInput } from "../types.js";

export interface LineToken {
  start: number;
  end: number;
  word?: OcrWord;
}

export interface SourceLine {
  pageNumber: number;
  /** 0-based index within the page. */
  index: number;
  text: string;
  tokens: LineToken[];
}

export interface Span {
  start: number;
  end: number;
}

export interface SpanEvidence {
  boundingBox?: BoundingBox;
  /** Mean confidence of the cited words, or undefined when no words back the span. */
  wordConfidence?: number;
}

export function assembleLines(doc: DocumentInput): SourceLine[] {
  return [...doc.pages].sort((a, b) => a.pageNumber - b.pageNumber).flatMap(linesFromPage);
}

export function linesFromPage(page: PageInput): SourceLine[] {
  if (page.text !== undefined && page.text.trim().length > 0) {
    const raw = page.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const lines = raw.map((text, index) => ({ pageNumber: page.pageNumber, index, text, tokens: tokenize(text) }));
    if (page.words && page.words.length > 0) alignWords(lines, page.words);
    return lines;
  }
  if (page.words && page.words.length > 0) return linesFromWords(page.pageNumber, page.words);
  return [];
}

export function tokenize(text: string): LineToken[] {
  const tokens: LineToken[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push({ start: m.index, end: m.index + m[0].length });
  return tokens;
}

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Greedy, tolerant alignment of text tokens to OCR words in reading order. Tokens that cannot
 * be matched simply carry no word (and therefore no box) — never a wrong box.
 */
function alignWords(lines: SourceLine[], words: OcrWord[]): void {
  const LOOKAHEAD = 4;
  let cursor = 0;
  for (const line of lines) {
    for (const token of line.tokens) {
      const wanted = normalizeToken(line.text.slice(token.start, token.end));
      if (wanted.length === 0) continue;
      for (let i = cursor; i < Math.min(words.length, cursor + LOOKAHEAD + 1); i++) {
        const word = words[i];
        if (word && normalizeToken(word.text) === wanted) {
          token.word = word;
          cursor = i + 1;
          break;
        }
      }
    }
  }
}

/** Groups words into lines by vertical centre, then orders each line left-to-right. */
function linesFromWords(pageNumber: number, words: OcrWord[]): SourceLine[] {
  const sorted = [...words].sort((a, b) => centreY(a) - centreY(b));
  const groups: OcrWord[][] = [];
  for (const word of sorted) {
    const current = groups[groups.length - 1];
    if (current) {
      const first = current[0];
      const tolerance = Math.max(0.004, 0.6 * (first ? first.box.h : 0));
      if (first && Math.abs(centreY(word) - centreY(first)) <= tolerance) {
        current.push(word);
        continue;
      }
    }
    groups.push([word]);
  }
  return groups.map((group, index) => {
    const ordered = [...group].sort((a, b) => a.box.x - b.box.x);
    let text = "";
    const tokens: LineToken[] = [];
    for (const word of ordered) {
      const clean = word.text.trim();
      if (clean.length === 0) continue;
      if (text.length > 0) text += " ";
      tokens.push({ start: text.length, end: text.length + clean.length, word });
      text += clean;
    }
    return { pageNumber, index, text, tokens };
  }).filter((l) => l.text.length > 0);
}

function centreY(word: OcrWord): number {
  return word.box.y + word.box.h / 2;
}

export function unionBoxes(boxes: BoundingBox[]): BoundingBox | undefined {
  if (boxes.length === 0) return undefined;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  // Rounded to 6 dp: boxes are stored as JSON and compared, so float drift must not leak out.
  const unit = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1e6) / 1e6;
  const x = unit(x0);
  const y = unit(y0);
  return { x, y, w: unit(unit(x1) - x), h: unit(unit(y1) - y) };
}

/** Evidence (box + word confidence) for characters [start, end) of a line; whole line when no span. */
export function evidenceFor(line: SourceLine, span?: Span): SpanEvidence {
  const s = span ?? { start: 0, end: line.text.length };
  const words = line.tokens
    .filter((t) => t.word !== undefined && t.start < s.end && t.end > s.start)
    .map((t) => t.word as OcrWord);
  if (words.length === 0) return {};
  const boundingBox = unionBoxes(words.map((w) => w.box));
  const wordConfidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;
  return { boundingBox, wordConfidence };
}
