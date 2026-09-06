/**
 * Adapters between the provider contracts and the pipeline's single `ClinicalExtractor` slot.
 *
 * `documentAiAsExtractor` lets an AI provider's candidates flow through exactly the same
 * guards as deterministic ones (`classifyThenExtract`: never-auto-proposed targets, value
 * schemas, H-37 "detected text must be on the cited page"), and stamps the provider's
 * provenance on every draft so a candidate can never claim a model it did not come from.
 * `composeExtractors` runs several extractors over one document and concatenates their
 * drafts; a failing member drops only its own drafts.
 */
import type {
  ClinicalExtractor,
  DocumentAiProvider,
  ExtractionCandidateDraft,
  ExtractionInput,
  ExtractorIdentity,
} from "../types.js";

export function documentAiAsExtractor(provider: DocumentAiProvider): ClinicalExtractor {
  const identity: ExtractorIdentity = {
    name: `${provider.provenance.provider}:${provider.provenance.model}`,
    version: provider.provenance.version,
  };
  return {
    identity,
    async extract(input: ExtractionInput): Promise<ExtractionCandidateDraft[]> {
      const drafts = await provider.extract({
        document: input.document,
        ...(input.classification ? { classification: input.classification } : {}),
      });
      return drafts.map((d) => ({ ...d, extractor: identity, modelProvenance: { ...provider.provenance } }));
    },
  };
}

export function composeExtractors(first: ClinicalExtractor, ...rest: ClinicalExtractor[]): ClinicalExtractor {
  const members = [first, ...rest];
  return {
    identity: first.identity,
    async extract(input: ExtractionInput): Promise<ExtractionCandidateDraft[]> {
      const results = await Promise.allSettled(members.map((m) => m.extract(input)));
      const drafts: ExtractionCandidateDraft[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") drafts.push(...result.value);
      }
      // The first (primary) extractor failing is the document failing; a secondary one
      // failing only loses its own proposals.
      const primary = results[0];
      if (primary && primary.status === "rejected") throw primary.reason;
      return drafts;
    },
  };
}
