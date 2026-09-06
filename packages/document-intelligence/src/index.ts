/**
 * @medpass/document-intelligence — pure classify → extract → confirm building blocks
 * (docs_v2/09). No database access, no ORM, no network at runtime (see test/purity.test.ts).
 */
export * from "./types.js";
export * from "./targets.js";
export * from "./confidence.js";
export {
  DeterministicClassifier,
  DETERMINISTIC_CLASSIFIER_NAME,
  DETERMINISTIC_CLASSIFIER_VERSION,
  classifyDeterministically,
  scoreKinds,
  confidenceFor,
  documentText,
  type ScoredKind,
} from "./classifier/deterministic.js";
export {
  DeterministicExtractor,
  DETERMINISTIC_EXTRACTOR,
  DEFAULT_TEXT_CONFIDENCE,
  MATCH_QUALITY,
  extractDeterministically,
  isMedicationLine,
  isValidSlotPattern,
  parseLabRow,
  type ParsedLabRow,
} from "./extractors/deterministic.js";
export { findDates, toIsoDate, type DateMatch } from "./extractors/dates.js";
export {
  assembleLines,
  linesFromPage,
  evidenceFor,
  unionBoxes,
  type SourceLine,
  type LineToken,
  type Span,
  type SpanEvidence,
} from "./extractors/lines.js";
export {
  classifyThenExtract,
  normalizeForContainment,
  type PipelineOptions,
  type PipelineResult,
  type DroppedCandidate,
} from "./pipeline.js";
// docs_v2/06 P3-3 — malware scanning (bytes in, verdict out; the worker wires clamd's socket)
export {
  MagicByteScanner,
  MAGIC_BYTE_SCANNER_ENGINE,
  MAGIC_BYTE_SCANNER_VERSION,
  scanMagicBytes,
  findPdfActiveContent,
} from "./malware/magic-byte-scanner.js";
export {
  ClamAvScanner,
  CLAMAV_SCANNER_ENGINE,
  CLAMD_CHUNK_BYTES,
  instreamFrames,
  versionFrames,
  parseReply,
  parseVersion,
  type ClamdTransport,
  type ClamdVerdict,
  type ClamAvScannerOptions,
} from "./malware/clamav-scanner.js";
// docs_v2/06 P3-2 — provider registry, the default AI provider, and the vendor contract checklist
export { ProviderRegistry } from "./providers/registry.js";
export {
  NullDocumentAiProvider,
  NULL_DOCUMENT_AI_PROVENANCE,
  DEFAULT_DOCUMENT_AI_MAX_INPUT_CHARS,
  documentInputChars,
} from "./providers/null-document-ai.js";
export {
  ocrProviderContract,
  documentAiProviderContract,
  type ContractCheck,
  type OcrContractOptions,
  type DocumentAiContractOptions,
} from "./testing/provider-contract.js";
export { documentAiAsExtractor, composeExtractors } from "./providers/document-ai-extractor.js";
