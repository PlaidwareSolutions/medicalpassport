/**
 * Drug-allergy: a confirmed medicine contains an ingredient the patient has
 * a normalized allergy to. Allergies without a normalized ingredient are
 * ignored — never guessed (docs/19).
 */

import { ALLERGY_SOURCE, RULE_VERSIONS, type AllergySnapshot, type MedicationSnapshot, type RawFinding } from "../types.js";

export function findAllergyMatches(medications: MedicationSnapshot[], allergies: AllergySnapshot[]): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const allergy of allergies) {
    if (!allergy.allergenIngredientId) continue;
    const matches = medications.filter((m) => m.ingredientIds.includes(allergy.allergenIngredientId!));
    for (const med of matches) {
      findings.push({
        category: "drug_allergy",
        severity: "high",
        medicationIds: [med.id],
        ruleKey: RULE_VERSIONS.allergyMatch.key,
        ruleVersion: RULE_VERSIONS.allergyMatch.version,
        sourceName: ALLERGY_SOURCE,
        explanationKey: "safety.explain.allergy",
        detail: { allergyLabel: allergy.label, medicationName: med.name },
      });
    }
  }
  return findings;
}
