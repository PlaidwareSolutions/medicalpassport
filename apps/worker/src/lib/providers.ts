/**
 * Provider registries for the document pipeline (docs_v2/09 §7, docs_v2/06 P3-2).
 *
 * The package defines the contracts and the registry; this file is where the worker says
 * which adapters exist in this process. Selection is `OCR_PROVIDER` / `DOCUMENT_AI_PROVIDER`
 * (packages/config); an unknown name fails at startup with the registered names in the
 * message. A vendor adapter (OD-11 for OCR, OD-12 for AI extraction) is one `register()`
 * call here plus a passing run of the contract checklist in its own test.
 */
import {
  NullDocumentAiProvider,
  ProviderRegistry,
  type DocumentAiProvider,
  type OcrProvider,
} from "@medpass/document-intelligence";
import { TesseractOcrProvider } from "../processors/ocr";

export const ocrProviders = new ProviderRegistry<OcrProvider>("ocr").register("tesseract", () => new TesseractOcrProvider());

export const documentAiProviders = new ProviderRegistry<DocumentAiProvider>("document-ai").register(
  "null",
  () => new NullDocumentAiProvider(),
);

export interface ProviderSelection {
  OCR_PROVIDER: string;
  DOCUMENT_AI_PROVIDER: string;
}

export interface Providers {
  ocr: OcrProvider;
  documentAi: DocumentAiProvider;
}

export function resolveProviders(env: ProviderSelection): Providers {
  return {
    ocr: ocrProviders.resolve(env.OCR_PROVIDER),
    documentAi: documentAiProviders.resolve(env.DOCUMENT_AI_PROVIDER),
  };
}
