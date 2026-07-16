/**
 * Clinical-rules package — Stage 6 scaffold (inert).
 *
 * The deterministic safety engine (docs/09) will live here and execute ONLY
 * on Railway (API/worker). Nothing in this package may ever be evaluated in
 * a browser, service worker, native client, or Cloudflare Worker (docs/02
 * non-negotiable rule 6).
 *
 * What ships now: the finding-type vocabulary and the presentation constants
 * shared with clients (which render findings but never compute them).
 */
import type { SafetyFindingCategory } from "@medpass/domain";

export type FindingSeverity = "info" | "low" | "moderate" | "high";

/**
 * The four mandatory statements every patient-facing warning must carry
 * (docs/02 clinical-warning contract). Localization keys.
 */
export const MANDATORY_WARNING_STATEMENT_KEYS = [
  "safety.statement.may_be_intentional",
  "safety.statement.more_info_may_be_needed",
  "safety.statement.do_not_change_independently",
  "safety.statement.confirm_with_professional",
] as const;

/** Shown whenever validated data is unavailable. Never fabricate (docs/19). */
export const NO_RELIABLE_DATA_KEY = "safety.no_reliable_data";

export const FINDING_TITLE_KEYS: Record<SafetyFindingCategory, string> = {
  exact_ingredient_duplication: "safety.finding.exact_duplicate",
  partial_ingredient_duplication: "safety.finding.partial_duplicate",
  therapeutic_class_duplication: "safety.finding.class_duplicate",
  drug_drug_interaction: "safety.finding.interaction",
  drug_allergy: "safety.finding.allergy",
  drug_condition: "safety.finding.condition",
  food: "safety.finding.food",
  alcohol: "safety.finding.alcohol",
  schedule_conflict: "safety.finding.schedule_conflict",
  dose_differs_from_prescription: "safety.finding.dose_differs",
  missing_information: "safety.finding.missing_information",
  uncertain_normalization: "safety.finding.uncertain_normalization",
};
