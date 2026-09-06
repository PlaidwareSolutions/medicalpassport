/**
 * Uncertain normalization: any medicine whose catalog match is not confirmed
 * gets an info-level finding so it is never silently skipped.
 */

import { CATALOG_SOURCE, RULE_VERSIONS, type MedicationSnapshot, type RawFinding } from "../types.js";

export function findUncertainNormalization(medications: MedicationSnapshot[]): RawFinding[] {
  return medications
    .filter((m) => m.normalizationStatus !== "confirmed")
    .map((m) => ({
      category: "uncertain_normalization",
      severity: "info" as const,
      medicationIds: [m.id],
      ruleKey: RULE_VERSIONS.uncertainNormalization.key,
      ruleVersion: RULE_VERSIONS.uncertainNormalization.version,
      sourceName: CATALOG_SOURCE,
      explanationKey: "safety.explain.uncertain_normalization",
      detail: { medicationName: m.name },
    }));
}
