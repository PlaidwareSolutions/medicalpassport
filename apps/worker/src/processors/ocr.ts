import { createWorker, type Worker } from "tesseract.js";

export const OCR_ENGINE = "tesseract.js";
export const OCR_ENGINE_VERSION = "7.0.0";

let workerPromise: Promise<Worker> | undefined;

/**
 * Lazily creates a single reusable Tesseract worker (English only this
 * pass — docs/22: Indic-script/handwriting OCR needs specialized models,
 * likely a paid provider per OD-11). Real OCR, no API key, runs locally.
 */
function getWorker(): Promise<Worker> {
  workerPromise ??= createWorker("eng");
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
  const worker = await workerPromise;
  workerPromise = undefined;
  await worker.terminate();
}
