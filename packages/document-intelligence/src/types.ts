/**
 * @medpass/document-intelligence — shared types for the classify → extract → confirm
 * pipeline (docs_v2/09 §2, §4, §5, §7). Pure data: no database, no network.
 */

/** docs_v2/09 §4 — the kinds the classifier can emit. The patient always confirms or overrides. */
export const DOCUMENT_KINDS = [
  "prescription",
  "laboratory_report",
  "imaging_report",
  "discharge_summary",
  "consultation_note",
  "vaccination_record",
  "referral",
  "insurance",
  "invoice",
  "medicine_packaging",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Normalized page coordinates, 0–1 of page width/height (docs_v2/04 §7.5 `boundingBox`). */
export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One OCR word with its confidence (0–1) and normalized box. */
export interface OcrWord {
  text: string;
  confidence: number;
  box: BoundingBox;
}

export interface PageInput {
  /** 1-based, matches `DocumentPage.pageNumber`. */
  pageNumber: number;
  width?: number;
  height?: number;
  /** Raw text (pdf text layer or OCR). When absent, lines are rebuilt from `words`. */
  text?: string;
  words?: OcrWord[];
  /**
   * Page-level OCR confidence 0–1 as the engine reported it. Used as the word-confidence
   * fallback for lines that no word box backs (docs_v2/16 §3 defect 5): an engine that was
   * unsure about the whole page must not produce candidates that look sure.
   */
  confidence?: number;
}

export interface DocumentInput {
  /** Kind chosen by the patient/provider. When set it always wins over the classifier (docs_v2/09 §4). */
  kind?: DocumentKind;
  pages: PageInput[];
  mimeType: string;
  /** True when `text` came from a PDF text layer rather than OCR (word confidence is then 1). */
  pdfTextLayer?: boolean;
}

export interface ClassificationResult {
  kind: DocumentKind;
  /** 0–1. */
  confidence: number;
  classifiedBy: "deterministic" | "model";
  /** PHI-free signal names that fired (e.g. "keyword:haemoglobin"), for metrics and debugging. */
  signals: string[];
}

export interface ExtractorIdentity {
  name: string;
  version: string;
}

/** Provenance of AI-derived candidates (docs_v2/04 §7.4 `DocumentExtraction`). */
export interface ModelProvenance {
  provider: string;
  model: string;
  version: string;
  promptVersion: string;
}

/**
 * A proposal for exactly one field of one target entity (docs_v2/09 §5). Nothing here is
 * clinical data until a person confirms it through the single materialization path
 * (docs_v2/09 §1 rule 3).
 */
export interface ExtractionCandidateDraft {
  targetEntity: string;
  targetField: string;
  pageNumber: number;
  boundingBox?: BoundingBox;
  /** Exactly what was on the page (the source line), shown beside the proposal. */
  detectedText: string;
  /** Shape is governed per entity/field by `targets.ts`. */
  proposedValue: unknown;
  /** 0–1, see `confidence.ts`. */
  confidence: number;
  extractor: ExtractorIdentity;
  modelProvenance?: ModelProvenance;
  /**
   * Optional grouping key so callers can show candidates that came from the same source
   * line together (e.g. all fields of one medication line). Format is extractor-defined.
   */
  groupKey?: string;
}

// ---------------------------------------------------------------------------
// Provider adapters (docs_v2/09 §7, docs_v2/06 P3-2)
// ---------------------------------------------------------------------------

/** One OCR line: its text, the engine's line confidence (0–1), its box and the words it holds. */
export interface OcrLine {
  text: string;
  confidence: number;
  box?: BoundingBox;
  words: OcrWord[];
}

/** What an OCR adapter is given: the page bytes and what the upload declared them to be. */
export interface OcrInput {
  bytes: Uint8Array;
  contentType: string;
  /** 1-based, matches `DocumentPage.pageNumber`; echoed for provenance only. */
  pageNumber: number;
  /** BCP-47 / engine language hints in preference order (e.g. ["eng", "hin"]). */
  languageHints?: string[];
}

export interface OcrResult {
  text: string;
  /** Per-line text with confidence 0–1 (the vendor contract's first requirement). */
  lines: OcrLine[];
  /** Every word with confidence 0–1 and a normalized box, in reading order. */
  words: OcrWord[];
  /** BCP-47 / engine language code when known. */
  language?: string;
  /** Page-level confidence 0–1. */
  confidence: number;
  /** Source image size in pixels when the adapter knows it (boxes are normalized regardless). */
  width?: number;
  height?: number;
  /** Provenance, copied from the provider that produced this result. */
  engine: string;
  engineVersion: string;
}

/**
 * OCR adapter contract (docs_v2/09 §7 `OcrProvider`). Every implementation — Tesseract in
 * the worker, a vendor behind OD-11 — must pass `ocrProviderContract` (src/testing).
 */
export interface OcrProvider {
  readonly engine: string;
  readonly engineVersion: string;
  /** Largest input accepted, in bytes; anything larger is rejected before any engine work. */
  readonly maxInputBytes: number;
  recognize(input: OcrInput): Promise<OcrResult>;
}

export interface DocumentAiInput {
  document: DocumentInput;
  /** Effective classification (user choice already applied). */
  classification?: ClassificationResult;
}

/**
 * AI extractor contract (docs_v2/09 §7 `LlmClinicalExtractor`, §8). Output is candidates only —
 * never clinical rows — and every candidate carries the provider's `ModelProvenance`. Real
 * providers stay behind OD-12 (contractual no-training terms); `NullDocumentAiProvider` is the
 * default everywhere.
 */
export interface DocumentAiProvider {
  readonly provenance: ModelProvenance;
  /** Largest document (sum of page text lengths, in characters) accepted. */
  readonly maxInputChars: number;
  extract(input: DocumentAiInput): Promise<ExtractionCandidateDraft[]>;
}

export interface DocumentClassifier {
  classify(doc: DocumentInput): Promise<ClassificationResult>;
}

/** Result of a caller-supplied medication catalog lookup for one line of text. */
export interface CatalogMatch {
  productId: string;
  /** Human label (brand name) for the proposal. */
  label: string;
  /** The substring of the line that matched (used for the bounding box). */
  matchedText: string;
  /** 0–1 match quality; defaults to 0.9 (exact brand-name substring) when omitted. */
  quality?: number;
}

/**
 * Catalog lookup injected by the caller — the package has no database access, so brand
 * matching is a callback (docs_v2/09 §2 "Normalization: catalog match").
 */
export type CatalogMatcher = (line: string) => CatalogMatch | null;

export interface ExtractionInput {
  document: DocumentInput;
  /** Effective classification (user choice already applied by the pipeline). */
  classification?: ClassificationResult;
  catalogMatcher?: CatalogMatcher;
}

export interface ClinicalExtractor {
  readonly identity: ExtractorIdentity;
  extract(input: ExtractionInput): Promise<ExtractionCandidateDraft[]>;
}

/** Malware scanning lives in ./malware (docs_v2/06 P3-3); re-exported from the index. */
export type { MalwareScanner, MalwareScanResult, MalwareVerdict } from "./malware/types.js";
