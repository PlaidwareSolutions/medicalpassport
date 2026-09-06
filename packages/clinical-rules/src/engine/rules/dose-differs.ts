/**
 * Compares the medicine's very first confirmed instruction against the one
 * in force now. Instructions are copy-on-write (docs/13), so this is a
 * simple, honest diff over the patient's own recorded history — never an
 * inference about whether a doctor actually authorized the change (docs/09:
 * dose/frequency changes are always attributed to the patient's own
 * recording, this only surfaces that a change happened at all).
 */

import { INSTRUCTION_HISTORY_SOURCE, RULE_VERSIONS, type MedicationSnapshot, type RawFinding } from "../types.js";

export function findDoseDiffersFromPrescription(medications: MedicationSnapshot[]): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const med of medications) {
    const first = med.firstInstruction;
    const current = med.currentInstruction;
    if (!first || !current) continue;
    const changed =
      first.doseQuantity !== current.doseQuantity ||
      first.frequencyCode !== current.frequencyCode ||
      (first.pattern ?? null) !== (current.pattern ?? null);
    if (!changed) continue;
    findings.push({
      category: "dose_differs_from_prescription",
      severity: "moderate",
      medicationIds: [med.id],
      ruleKey: RULE_VERSIONS.doseDiffers.key,
      ruleVersion: RULE_VERSIONS.doseDiffers.version,
      sourceName: INSTRUCTION_HISTORY_SOURCE,
      explanationKey: "safety.explain.dose_differs",
      detail: {
        medicationName: med.name,
        originalDoseQuantity: first.doseQuantity,
        currentDoseQuantity: current.doseQuantity,
        originalFrequencyCode: first.frequencyCode,
        currentFrequencyCode: current.frequencyCode,
      },
    });
  }
  return findings;
}
