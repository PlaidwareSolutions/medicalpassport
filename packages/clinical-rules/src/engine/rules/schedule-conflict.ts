/**
 * Flags a mismatch between the confirmed instruction and the actual
 * reminder schedule: a fixed-frequency medicine with no active schedule
 * (so the patient is not being reminded at all) or a PRN medicine that
 * somehow still has one (docs/16: PRN medicines generate no scheduled
 * reminders). Both indicate the schedule and the instruction disagree —
 * never a clinical judgment, just an internal-consistency check.
 */

import { AUTO_SCHEDULABLE_FREQUENCY_CODES } from "@medpass/domain";
import { RULE_VERSIONS, SCHEDULE_SOURCE, type MedicationSnapshot, type RawFinding } from "../types.js";

const AUTO_SCHEDULABLE_FREQUENCIES = new Set<string>(AUTO_SCHEDULABLE_FREQUENCY_CODES);

export function findScheduleConflicts(medications: MedicationSnapshot[]): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const med of medications) {
    if (med.isPrn) {
      if (med.hasActiveSchedule) {
        findings.push({
          category: "schedule_conflict",
          severity: "low",
          medicationIds: [med.id],
          ruleKey: RULE_VERSIONS.scheduleConflictPrn.key,
          ruleVersion: RULE_VERSIONS.scheduleConflictPrn.version,
          sourceName: SCHEDULE_SOURCE,
          explanationKey: "safety.explain.schedule_conflict_prn",
          detail: { medicationName: med.name },
        });
      }
      continue;
    }
    const frequencyCode = med.currentInstruction?.frequencyCode;
    if (frequencyCode && AUTO_SCHEDULABLE_FREQUENCIES.has(frequencyCode) && !med.hasActiveSchedule) {
      findings.push({
        category: "schedule_conflict",
        severity: "moderate",
        medicationIds: [med.id],
        ruleKey: RULE_VERSIONS.scheduleConflictMissing.key,
        ruleVersion: RULE_VERSIONS.scheduleConflictMissing.version,
        sourceName: SCHEDULE_SOURCE,
        explanationKey: "safety.explain.schedule_conflict_missing",
        detail: { medicationName: med.name, frequencyCode },
      });
    }
  }
  return findings;
}
