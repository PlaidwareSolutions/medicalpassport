/**
 * Conflicting instructions (docs_v2/06 P2-3, docs_v2/10 §3): the same
 * normalized ingredient set is recorded as a *current* medicine more than
 * once, and the instructions in force differ (dose quantity, dose unit,
 * frequency code, or dosing pattern). The explanation quotes each
 * instruction verbatim — the original captured text when there is one,
 * else a plain rendering such as "1 tablet BD" — and never says which one
 * is right (docs/02: explain, never recommend).
 *
 * Exclusions, all deliberate:
 * - Only confirmed matches are compared (same exclusion as the duplication rules).
 * - Medicines with no current instruction have nothing to compare.
 * - An as-needed (PRN) entry is never compared against a scheduled one: the
 *   difference there *is* the PRN designation, which the exact-duplication
 *   finding on the pair already shows, so flagging it again would add a
 *   conflict to every PRN + scheduled pair without new information. Two PRN
 *   entries, or two scheduled entries, are compared normally.
 */

import {
  CURRENT_INSTRUCTIONS_SOURCE,
  RULE_VERSIONS,
  groupByIngredientSet,
  renderInstruction,
  type InstructionSnapshot,
  type MedicationSnapshot,
  type RawFinding,
} from "../types.js";

type Instructed = MedicationSnapshot & { currentInstruction: InstructionSnapshot };

function instructionKey(i: InstructionSnapshot): string {
  return [i.doseQuantity, i.doseUnit ?? "", i.frequencyCode, i.pattern ?? ""].join("|");
}

function findConflictsWithin(meds: Instructed[], findings: RawFinding[]): void {
  if (meds.length < 2) return;
  const distinct = new Set(meds.map((m) => instructionKey(m.currentInstruction)));
  if (distinct.size < 2) return;

  const medicationIds = meds.map((m) => m.id);
  findings.push({
    category: "conflicting_instructions",
    severity: "moderate",
    medicationIds,
    ruleKey: RULE_VERSIONS.conflictingInstructions.key,
    ruleVersion: RULE_VERSIONS.conflictingInstructions.version,
    sourceName: CURRENT_INSTRUCTIONS_SOURCE,
    explanationKey: "safety.explain.conflicting_instructions",
    detail: {
      ingredientNames: meds[0]!.ingredientNames,
      medicationNames: meds.map((m) => m.name),
      instructions: meds.map((m) => ({
        medicationId: m.id,
        medicationName: m.name,
        instructionId: m.currentInstruction.id ?? null,
        text: renderInstruction(m.currentInstruction),
        doseQuantity: m.currentInstruction.doseQuantity,
        doseUnit: m.currentInstruction.doseUnit ?? null,
        frequencyCode: m.currentInstruction.frequencyCode,
        pattern: m.currentInstruction.pattern ?? null,
        prescriptionId: m.prescription?.id ?? null,
      })),
      /** Pre-rendered, verbatim, for the {instructions} explanation parameter. */
      instructionTexts: meds.map((m) => renderInstruction(m.currentInstruction)),
      evidence: {
        medicationIds,
        instructionIds: meds.map((m) => m.currentInstruction.id).filter((id): id is string => !!id),
      },
    },
  });
}

export function findConflictingInstructions(medications: MedicationSnapshot[]): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const group of groupByIngredientSet(medications)) {
    const instructed = group.filter((m): m is Instructed => !!m.currentInstruction);
    findConflictsWithin(instructed.filter((m) => !m.isPrn), findings);
    findConflictsWithin(instructed.filter((m) => !!m.isPrn), findings);
  }
  return findings;
}
