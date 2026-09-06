import type { OcrResult, OcrWord, PageInput } from "@medpass/document-intelligence";

/**
 * The per-page `ocr-tmp` object (docs_v2/09 §2 "raw text + word boxes stored as objects"):
 * what `document_classify` writes and `document_extract` reads. Version 1 is JSON carrying
 * the text, the word boxes with their confidences, the page confidence and the engine that
 * produced them — everything the extractor's confidence policy needs (docs_v2/16 §3
 * defect 5). Objects written before this format (plain text, `text/plain`) still decode:
 * text only, no words, no confidence, so they fall back to the fixed default exactly as
 * they always did.
 */
export const OCR_TEXT_OBJECT_CONTENT_TYPE = "application/json";

export interface OcrTextObjectV1 {
  version: 1;
  text: string;
  words: OcrWord[];
  /** Page-level confidence 0–1; absent for a PDF text layer (exact by definition). */
  confidence?: number;
  language?: string;
  width?: number;
  height?: number;
  engine: string;
  engineVersion: string;
  pdfTextLayer: boolean;
}

export function encodeOcrTextObject(value: OcrTextObjectV1): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

export function fromOcrResult(result: OcrResult): OcrTextObjectV1 {
  return {
    version: 1,
    text: result.text,
    words: result.words,
    confidence: result.confidence,
    ...(result.language ? { language: result.language } : {}),
    ...(result.width && result.height ? { width: result.width, height: result.height } : {}),
    engine: result.engine,
    engineVersion: result.engineVersion,
    pdfTextLayer: false,
  };
}

export function fromPdfText(text: string, engine: string, engineVersion: string): OcrTextObjectV1 {
  return { version: 1, text, words: [], engine, engineVersion, pdfTextLayer: true };
}

/** Tolerant decode: JSON v1 when it parses as such, else the legacy plain-text body. */
export function decodeOcrTextObject(body: Buffer): OcrTextObjectV1 | { text: string } {
  const raw = body.toString("utf8");
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Partial<OcrTextObjectV1>;
      if (parsed.version === 1 && typeof parsed.text === "string") {
        return {
          version: 1,
          text: parsed.text,
          words: Array.isArray(parsed.words) ? parsed.words : [],
          ...(typeof parsed.confidence === "number" ? { confidence: parsed.confidence } : {}),
          ...(typeof parsed.language === "string" ? { language: parsed.language } : {}),
          ...(typeof parsed.width === "number" && typeof parsed.height === "number" ? { width: parsed.width, height: parsed.height } : {}),
          engine: typeof parsed.engine === "string" ? parsed.engine : "unknown",
          engineVersion: typeof parsed.engineVersion === "string" ? parsed.engineVersion : "unknown",
          pdfTextLayer: parsed.pdfTextLayer === true,
        };
      }
    } catch {
      // Not our JSON — a page whose text happens to start with "{"; treat as legacy text.
    }
  }
  return { text: raw };
}

/** The extractor's view of one stored page. */
export function toPageInput(pageNumber: number, stored: OcrTextObjectV1 | { text: string }): PageInput {
  const page: PageInput = { pageNumber, text: stored.text };
  if ("version" in stored) {
    if (stored.words.length > 0) page.words = stored.words;
    if (!stored.pdfTextLayer && typeof stored.confidence === "number") page.confidence = stored.confidence;
    if (stored.width && stored.height) {
      page.width = stored.width;
      page.height = stored.height;
    }
  }
  return page;
}
