/**
 * Exact / partial ingredient duplication: two confirmed medicines sharing an
 * ingredient. Partial (moderate) when any of them is a combination product,
 * exact (high) otherwise.
 */

import { CATALOG_SOURCE, RULE_VERSIONS, type MedicationSnapshot, type RawFinding } from "../types.js";

export function findIngredientDuplicates(medications: MedicationSnapshot[]): RawFinding[] {
  const byIngredient = new Map<string, { name: string; meds: MedicationSnapshot[] }>();
  for (const med of medications) {
    med.ingredientIds.forEach((ingredientId, i) => {
      const entry = byIngredient.get(ingredientId) ?? { name: med.ingredientNames[i]!, meds: [] };
      entry.meds.push(med);
      byIngredient.set(ingredientId, entry);
    });
  }

  const findings: RawFinding[] = [];
  for (const [ingredientId, { name, meds }] of byIngredient) {
    if (meds.length < 2) continue;
    const anyCombination = meds.some((m) => m.isCombination);
    const rule = anyCombination ? RULE_VERSIONS.partialDuplicate : RULE_VERSIONS.exactDuplicate;
    findings.push({
      category: anyCombination ? "partial_ingredient_duplication" : "exact_ingredient_duplication",
      severity: anyCombination ? "moderate" : "high",
      medicationIds: meds.map((m) => m.id),
      ruleKey: rule.key,
      ruleVersion: rule.version,
      sourceName: CATALOG_SOURCE,
      explanationKey: anyCombination ? "safety.explain.partial_duplicate" : "safety.explain.exact_duplicate",
      detail: { ingredientId, ingredientName: name, medicationNames: meds.map((m) => m.name) },
    });
  }
  return findings;
}
