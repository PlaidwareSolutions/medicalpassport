import { readFile } from "node:fs/promises";
import pdfParse from "pdf-parse";

export const PDF_TEXT_ENGINE = "pdf-parse";
export const PDF_TEXT_ENGINE_VERSION = "1.1.1";

/**
 * Extracts embedded text from an uploaded PDF prescription (docs/22 Stage 8
 * follow-up) — a real text layer, not OCR, so this only works for PDFs that
 * actually have one (e.g. exported from a clinic system), not a scanned
 * image saved as PDF. Feeds the exact same deterministic candidate
 * detection as the OCR path (docs/09 §6): no separate code path for
 * "confidence" or "confirmation", just a different raw-text source.
 */
export async function extractPdfText(pdfPath: string): Promise<string> {
  const buffer = await readFile(pdfPath);
  const { text } = await pdfParse(buffer);
  return text;
}
