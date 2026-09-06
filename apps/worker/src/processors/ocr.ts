import { createRequire } from "node:module";
import { createWorker, type Worker } from "tesseract.js";
import { createLogger } from "@medpass/observability";

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

export async function runOcr(image: Buffer): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return data.text;
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
