/**
 * Deterministic safety rules — pure functions over a normalized snapshot of
 * a profile's current medications; no I/O, so the detection logic itself is
 * directly unit-testable. Moved verbatim from
 * apps/api/src/modules/safety/safety-rules.ts (docs_v2/06 P2-4, docs_v2/10 §3).
 *
 * Scope this pass: exact/partial ingredient duplication, therapeutic-class
 * duplication, drug-allergy, uncertain-normalization, schedule conflict,
 * dose-differs-from-prescription, and (Phase 2, P2-3) multiple active
 * prescriptions and conflicting instructions. Drug-drug interaction, drug-condition,
 * food, and alcohol checks need a licensed data source (OD-4) or
 * clinically-reviewed content that does not exist yet — never fabricated
 * (docs/19).
 *
 * docs/09 names "schedule conflict" and "dose differs from confirmed
 * prescription" as categories 9–10 but does not define their mechanics —
 * unlike the interaction/allergy checks, no external spec pins these down.
 * Both are defined purely from data the app already has, never fabricated:
 * a schedule conflict is the reminder schedule not matching what the
 * confirmed instruction implies it should be (missing entirely, or present
 * despite being PRN); dose-differs compares the medicine's first-ever
 * confirmed instruction against its current one. Both flag for
 * confirmation only — never a recommendation to act (docs/02).
 *
 * This engine executes ONLY on the server (API/worker). Clients render
 * findings; they never compute them (docs/02 non-negotiable rule 6).
 */

import { findIngredientDuplicates } from "./rules/duplication.js";
import { findClassDuplicates } from "./rules/therapeutic-class.js";
import { findAllergyMatches } from "./rules/drug-allergy.js";
import { findUncertainNormalization } from "./rules/uncertain-normalization.js";
import { findScheduleConflicts } from "./rules/schedule-conflict.js";
import { findDoseDiffersFromPrescription } from "./rules/dose-differs.js";
import { findMultipleActivePrescriptions } from "./rules/multiple-prescriptions.js";
import { findConflictingInstructions } from "./rules/conflicting-instructions.js";
import type { AllergySnapshot, MedicationSnapshot, RawFinding } from "./types.js";

export function evaluateSafety(medications: MedicationSnapshot[], allergies: AllergySnapshot[]): RawFinding[] {
  const findings: RawFinding[] = [];
  const checkable = medications.filter((m) => m.normalizationStatus === "confirmed");

  findings.push(...findIngredientDuplicates(checkable));
  findings.push(...findClassDuplicates(checkable, findings));
  findings.push(...findAllergyMatches(checkable, allergies));
  findings.push(...findUncertainNormalization(medications));
  findings.push(...findScheduleConflicts(medications));
  findings.push(...findDoseDiffersFromPrescription(medications));
  // Phase 2 (docs_v2/06 P2-3) — appended after the original rules so the
  // findings above are byte-for-byte what they were before these existed.
  findings.push(...findMultipleActivePrescriptions(checkable));
  findings.push(...findConflictingInstructions(checkable));

  return findings;
}
