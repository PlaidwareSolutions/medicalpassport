/**
 * classify → extract → validate (docs_v2/09 §2). The pipeline never writes anything: it returns
 * validated candidate drafts for the caller to persist as `ExtractionCandidate` rows, and the
 * list of drafts it dropped with reasons (PHI-free reason codes, safe to log).
 *
 * Guards applied to every candidate, whatever produced it:
 *  - `assertProposable` — unknown targets and never-auto-proposed fields (dose quantity, lab
 *    interpretation) are dropped (docs_v2/09 §1 rule 4, §5)
 *  - `validateCandidateDraft` — shape and per-field value schema
 *  - H-37 — `detectedText` must actually appear on the cited page, else dropped
 */
import { assertProposable, validateCandidateDraft } from "./targets.js";
import type {
  CatalogMatcher,
  ClassificationResult,
  ClinicalExtractor,
  DocumentClassifier,
  DocumentInput,
  DocumentKind,
  ExtractionCandidateDraft,
} from "./types.js";

export interface PipelineOptions {
  classifier: DocumentClassifier;
  extractor: ClinicalExtractor;
  catalogMatcher?: CatalogMatcher;
}

export interface DroppedCandidate {
  /** The offending draft, verbatim, for the caller's debug store (contains page text — not for logs). */
  draft: unknown;
  reasons: string[];
}

export interface PipelineResult {
  classification: ClassificationResult;
  /** Kind used for extraction: the user's choice when given, else the classifier's. */
  kind: DocumentKind;
  candidates: ExtractionCandidateDraft[];
  dropped: DroppedCandidate[];
}

export async function classifyThenExtract(input: DocumentInput, options: PipelineOptions): Promise<PipelineResult> {
  const classification = await options.classifier.classify(input);
  const kind: DocumentKind = input.kind ?? classification.kind;
  const effective: ClassificationResult = input.kind
    ? { ...classification, kind, signals: ["user-selected-kind", ...classification.signals] }
    : classification;

  let rawDrafts: unknown[];
  try {
    rawDrafts = await options.extractor.extract({
      document: input,
      classification: effective,
      ...(options.catalogMatcher ? { catalogMatcher: options.catalogMatcher } : {}),
    });
  } catch (err) {
    // A bad page must not take the whole document down: the classification still stands.
    return {
      classification,
      kind,
      candidates: [],
      dropped: [{ draft: undefined, reasons: [`extractor_failed:${err instanceof Error ? err.name : "unknown"}`] }],
    };
  }

  const pageText = new Map<number, string>();
  for (const page of input.pages) {
    pageText.set(page.pageNumber, normalizeForContainment(page.text ?? page.words?.map((w) => w.text).join(" ") ?? ""));
  }

  const candidates: ExtractionCandidateDraft[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const raw of Array.isArray(rawDrafts) ? rawDrafts : []) {
    const reasons = guard(raw, pageText);
    if (reasons.length > 0) {
      dropped.push({ draft: raw, reasons });
      continue;
    }
    const validated = validateCandidateDraft(raw);
    if (!validated.ok) {
      dropped.push({ draft: raw, reasons: validated.reasons });
      continue;
    }
    candidates.push(validated.draft);
  }

  return { classification, kind, candidates, dropped };
}

function guard(raw: unknown, pageText: Map<number, string>): string[] {
  const reasons: string[] = [];
  if (typeof raw !== "object" || raw === null) return ["shape:$:not an object"];
  const d = raw as Partial<ExtractionCandidateDraft>;
  if (typeof d.targetEntity === "string" && typeof d.targetField === "string") {
    try {
      assertProposable(d.targetEntity, d.targetField);
    } catch (err) {
      reasons.push(err instanceof Error && err.name === "NeverAutoProposedError"
        ? `never_auto_proposed:${d.targetEntity}.${d.targetField}`
        : `unknown_target:${d.targetEntity}.${d.targetField}`);
    }
  }
  if (typeof d.pageNumber === "number" && typeof d.detectedText === "string") {
    const text = pageText.get(d.pageNumber);
    if (text === undefined) reasons.push(`page_not_in_document:${d.pageNumber}`);
    else if (!text.includes(normalizeForContainment(d.detectedText))) reasons.push("detected_text_not_on_page");
  }
  return reasons;
}

/**
 * Case/whitespace/punctuation-insensitive containment (OCR text is untrusted and noisy):
 * only letters and digits survive, so "500MG" and "500 mg" compare equal.
 */
export function normalizeForContainment(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
