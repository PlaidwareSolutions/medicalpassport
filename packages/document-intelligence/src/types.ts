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
// Provider adapters (docs_v2/09 §7)
// ---------------------------------------------------------------------------

export interface OcrResult {
  text: string;
  words: OcrWord[];
  /** BCP-47 / tesseract language code when known. */
  language?: string;
  /** Page-level confidence 0–1. */
  confidence: number;
}

export interface OcrProvider {
  extract(page: PageInput): Promise<OcrResult>;
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

/** Opaque storage reference (docs_v2/09 §9: no PHI in keys). */
export interface ObjectRef {
  bucket: string;
  objectKey: string;
  sha256?: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface ScanResult {
  status: "clean" | "infected" | "error";
  threatName?: string;
  scanner: { name: string; version: string };
  /** ISO-8601 timestamp. */
  scannedAt: string;
}

export interface MalwareScanner {
  scan(object: ObjectRef): Promise<ScanResult>;
}
