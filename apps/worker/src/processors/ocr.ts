import { createRequire } from "node:module";
import { createWorker, type Worker } from "tesseract.js";
import { clamp01, round4, type BoundingBox, type OcrInput, type OcrLine, type OcrProvider, type OcrResult, type OcrWord } from "@medpass/document-intelligence";
import { createLogger } from "@medpass/observability";
import { imageDimensions } from "../lib/image-dimensions";

const logger = createLogger("worker-ocr");

/**
 * Where a page the engine cannot read ends up. tesseract.js rejects the
 * `recognize()` promise for that job — which the queue runner catches and
 * retries or dead-letters like any failure — but then, with no handler
 * registered, ALSO throws the same error from inside its message listener,
 * where nothing can catch it. One truncated JPEG took the whole worker
 * process down with it on 2026-09-06, and with it every other patient's
 * document processing. Logging here is what stops the second throw; the
 * job's own failure is already handled by the rejection.
 */
function onEngineError(err: unknown): void {
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, "ocr engine reported an error for a job");
}

export const OCR_ENGINE = "tesseract.js";
/** Read from the installed package so stored extraction provenance can never drift from reality (docs_v2/16 §3 item 1). */
export const OCR_ENGINE_VERSION: string = (createRequire(__filename)("tesseract.js/package.json") as { version: string }).version;

/**
 * Largest page the adapter accepts. The API caps uploads well below this; the limit exists
 * so the vendor contract ("rejects oversize input") holds for this adapter too, and so a
 * runaway object can never be handed to the engine.
 */
export const TESSERACT_MAX_INPUT_BYTES = 25 * 1024 * 1024;

let workerPromise: Promise<Worker> | undefined;

/**
 * Lazily creates a single reusable Tesseract worker (English only this
 * pass — docs/22: Indic-script/handwriting OCR needs specialized models,
 * likely a paid provider per OD-11). Real OCR, no API key, runs locally.
 *
 * A failed start (e.g. the traineddata download failing once) must not
 * poison the process: the rejected promise is dropped so the next call
 * tries again (docs_v2/16 §3 item 4).
 */
function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", undefined, { errorHandler: onEngineError }).catch((err: unknown) => {
      workerPromise = undefined;
      throw err;
    });
  }
  return workerPromise;
}

/**
 * The default `OcrProvider` (docs_v2/09 §7, docs_v2/06 P3-2): Tesseract.js behind the
 * vendor contract. Word and line confidences come back on the engine's 0–100 scale and
 * boxes in pixels; this adapter is where they become 0–1 and page-normalized, so the
 * extractor's confidence policy (docs_v2/16 §3 defect 5) sees engine confidence, never a
 * fixed guess.
 */
export class TesseractOcrProvider implements OcrProvider {
  readonly engine = OCR_ENGINE;
  readonly engineVersion = OCR_ENGINE_VERSION;
  readonly maxInputBytes = TESSERACT_MAX_INPUT_BYTES;

  async recognize(input: OcrInput): Promise<OcrResult> {
    if (input.bytes.length > this.maxInputBytes) {
      throw new Error(`page too large for ${this.engine}: ${input.bytes.length} > ${this.maxInputBytes} bytes`);
    }
    const worker = await getWorker();
    // A view over the caller's bytes, not a copy — the engine reads, never writes.
    const image = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
    return toOcrResult(data, imageDimensions(input.bytes), this);
  }
}

const defaultProvider = new TesseractOcrProvider();

/** V1 path (`ocr_extraction`): text only. The V2 pipeline uses `TesseractOcrProvider` directly. */
export async function runOcr(image: Buffer): Promise<string> {
  const result = await defaultProvider.recognize({ bytes: image, contentType: "image/*", pageNumber: 1 });
  return result.text;
}

/** Node's tesseract.js worker runs in a child process — tests must terminate it explicitly to exit cleanly. */
export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = undefined;
  let worker: Worker;
  try {
    worker = await pending;
  } catch {
    return; // never started; nothing to terminate
  }
  await worker.terminate();
}

// ---------------------------------------------------------------------------
// tesseract.js `Page` → contract `OcrResult`
// ---------------------------------------------------------------------------

// Structural subset of tesseract.js's `Page` — only what the mapping reads, so tests can
// build fixtures without the engine's back-references (`Block.page`).
interface BboxLike {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface WordLike {
  text: string;
  confidence: number;
  bbox: BboxLike;
}
interface LineLike {
  text: string;
  confidence: number;
  bbox: BboxLike;
  words: WordLike[];
}
interface BlockLike {
  paragraphs: Array<{ lines: LineLike[] }>;
}
export interface PageLike {
  text: string;
  confidence: number;
  blocks?: BlockLike[] | null;
}

/**
 * Exported for the adapter's own tests: the mapping is where the two contracts (0–100 vs
 * 0–1, pixels vs page fractions) meet, and a mistake here would silently mis-rank every
 * candidate. When the image header gave no size, boxes are normalized against the extent
 * of the words the engine saw, so they still land inside 0–1.
 */
export function toOcrResult(
  page: PageLike,
  dimensions: { width: number; height: number } | undefined,
  identity: { engine: string; engineVersion: string },
): OcrResult {
  const rawLines = page.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) ?? [];
  const size = dimensions ?? extentOf(rawLines);
  // Corners are clamped before the size is derived, so x + w can never leave the page even
  // when the engine reports a box past the image edge.
  const norm = (bbox: BboxLike): BoundingBox => {
    const x0 = clamp01(bbox.x0 / size.width);
    const x1 = clamp01(bbox.x1 / size.width);
    const y0 = clamp01(bbox.y0 / size.height);
    const y1 = clamp01(bbox.y1 / size.height);
    return { x: round4(x0), y: round4(y0), w: round4(Math.max(0, x1 - x0)), h: round4(Math.max(0, y1 - y0)) };
  };

  const lines: OcrLine[] = [];
  for (const line of rawLines) {
    const words: OcrWord[] = line.words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => ({ text: w.text, confidence: pct(w.confidence), box: norm(w.bbox) }));
    const text = line.text.replace(/\s+$/, "");
    if (text.length === 0 && words.length === 0) continue;
    lines.push({ text, confidence: pct(line.confidence), box: norm(line.bbox), words });
  }

  // Without block output (an engine build that gave only text) the lines are the text's.
  if (lines.length === 0 && page.text.trim().length > 0) {
    for (const text of page.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      lines.push({ text, confidence: pct(page.confidence), words: [] });
    }
  }

  return {
    text: page.text,
    lines,
    words: lines.flatMap((l) => l.words),
    language: "eng",
    confidence: pct(page.confidence),
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    engine: identity.engine,
    engineVersion: identity.engineVersion,
  };
}

function pct(confidence: number): number {
  return round4(clamp01(confidence / 100));
}

function extentOf(lines: Array<{ bbox: BboxLike }>): { width: number; height: number } {
  let width = 1;
  let height = 1;
  for (const line of lines) {
    width = Math.max(width, line.bbox.x1);
    height = Math.max(height, line.bbox.y1);
  }
  return { width, height };
}
