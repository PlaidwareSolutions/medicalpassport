/**
 * Confidence policy (docs_v2/09 §6).
 *
 * Confidence is per candidate, 0–1. For deterministic extractors it is the product of the
 * OCR word confidence and the rule's match quality; AI extractors report a calibrated value.
 *
 * UI buckets:
 *   high   (>= preselect) — shown pre-selected as "looks right?"
 *   medium (>= check)     — shown as "please check"
 *   low                   — only in "other things we saw", never pre-selected
 *
 * IMPORTANT: these thresholds are constants and change ONLY with Gate 5 corpus evidence
 * (docs_v2/13). There is no auto-confirm at any threshold — a person always confirms.
 */
export const CONFIDENCE_THRESHOLDS = Object.freeze({
  preselect: 0.9,
  check: 0.6,
});

export type ConfidenceBucket = "high" | "medium" | "low";

export function bucket(confidence: number): ConfidenceBucket {
  if (!Number.isFinite(confidence)) return "low";
  if (confidence >= CONFIDENCE_THRESHOLDS.preselect) return "high";
  if (confidence >= CONFIDENCE_THRESHOLDS.check) return "medium";
  return "low";
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Deterministic confidence = OCR word confidence × match quality, clamped to 0–1.
 * A PDF text layer has word confidence 1, so the rule's match quality passes through unchanged.
 */
export function combine(ocrWordConfidence: number, matchQuality: number): number {
  return round4(clamp01(clamp01(ocrWordConfidence) * clamp01(matchQuality)));
}

/** Rounds to 4 dp so equal inputs always compare equal across platforms. */
export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
