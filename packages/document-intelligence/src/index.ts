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
