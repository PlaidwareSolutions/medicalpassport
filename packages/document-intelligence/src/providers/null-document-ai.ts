/**
 * The default `DocumentAiProvider` (docs_v2/06 P3-2): proposes nothing. Local, CI and every
 * environment without a contracted provider (OD-12) run this one, so the deterministic
 * extractor is the only source of candidates. It still enforces the contract — provenance,
 * the size limit, input left untouched — so the pipeline around it behaves exactly as it
 * would around a real adapter.
 */
import type { DocumentAiInput, DocumentAiProvider, ExtractionCandidateDraft, ModelProvenance } from "../types.js";

export const NULL_DOCUMENT_AI_PROVENANCE: ModelProvenance = Object.freeze({
  provider: "null",
  model: "none",
  version: "0",
  promptVersion: "0",
});

/** Sum of page text lengths a document AI provider is asked to accept at most. */
export const DEFAULT_DOCUMENT_AI_MAX_INPUT_CHARS = 200_000;

export function documentInputChars(input: DocumentAiInput): number {
  return input.document.pages.reduce((sum, page) => sum + (page.text?.length ?? 0), 0);
}

export class NullDocumentAiProvider implements DocumentAiProvider {
  readonly provenance = NULL_DOCUMENT_AI_PROVENANCE;
  readonly maxInputChars = DEFAULT_DOCUMENT_AI_MAX_INPUT_CHARS;

  async extract(input: DocumentAiInput): Promise<ExtractionCandidateDraft[]> {
    const chars = documentInputChars(input);
    if (chars > this.maxInputChars) {
      throw new Error(`document too large for ${this.provenance.provider} provider: ${chars} > ${this.maxInputChars} chars`);
    }
    return [];
  }
}
