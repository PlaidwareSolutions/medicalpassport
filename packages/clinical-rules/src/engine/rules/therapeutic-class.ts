/**
 * Therapeutic-class duplication: two confirmed medicines in the same class
 * that are NOT already covered by an ingredient-level finding.
 */

import { CATALOG_SOURCE, RULE_VERSIONS, pairKey, type MedicationSnapshot, type RawFinding } from "../types.js";

export function findClassDuplicates(medications: MedicationSnapshot[], existing: RawFinding[]): RawFinding[] {
  // Skip pairs already covered by an ingredient-level finding to avoid
  // redundant noise for the same two medicines.
  const alreadyFlaggedPairs = new Set<string>();
  for (const f of existing) {
    for (let i = 0; i < f.medicationIds.length; i++) {
      for (let j = i + 1; j < f.medicationIds.length; j++) {
        alreadyFlaggedPairs.add(pairKey(f.medicationIds[i]!, f.medicationIds[j]!));
      }
    }
  }

  const byClass = new Map<string, MedicationSnapshot[]>();
  for (const med of medications) {
    for (const classId of med.classIds) {
      const list = byClass.get(classId) ?? [];
      list.push(med);
      byClass.set(classId, list);
    }
  }

  const findings: RawFinding[] = [];
  for (const meds of byClass.values()) {
    if (meds.length < 2) continue;
    const novel = meds.filter((m, i) => meds.some((other, j) => j !== i && !alreadyFlaggedPairs.has(pairKey(m.id, other.id))));
    if (novel.length < 2) continue;
    findings.push({
      category: "therapeutic_class_duplication",
      severity: "low",
      medicationIds: novel.map((m) => m.id),
      ruleKey: RULE_VERSIONS.classDuplicate.key,
      ruleVersion: RULE_VERSIONS.classDuplicate.version,
      sourceName: CATALOG_SOURCE,
      explanationKey: "safety.explain.class_duplicate",
      detail: { medicationNames: novel.map((m) => m.name) },
    });
  }
  return findings;
}
