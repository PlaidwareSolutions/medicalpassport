/**
 * Input/output types for the deterministic safety engine (docs_v2/10 §3).
 *
 * These are plain snapshot types — deliberately NOT Prisma row types. The
 * API maps its database rows into these snapshots at the call site so this
 * package never depends on Prisma or on apps/api.
 */

import type { FindingSeverity } from "../presentation.js";

export interface InstructionSnapshot {
  doseQuantity: number;
  frequencyCode: string;
  pattern: string | null;
  /** Row id — recorded as evidence by rules that compare instructions (P2-3). Optional: older snapshots lack it. */
  id?: string;
  /** Dose unit as confirmed ("tablet", "ml", …). Optional: older snapshots lack it. */
  doseUnit?: string | null;
  /** Original captured text (OCR / shorthand), preserved verbatim; quoted in explanations when present. */
  originalText?: string | null;
}

/** The prescription record a medication came from (docs/13) — optional evidence, never required. */
export interface PrescriptionSnapshot {
  id: string;
  /** ISO date (YYYY-MM-DD) as recorded by the patient — never inferred. */
  prescribedAt?: string | null;
  practitionerName?: string | null;
}

export interface MedicationSnapshot {
  id: string;
  name: string;
  normalizationStatus: string;
  isCombination: boolean;
  ingredientIds: string[];
  ingredientNames: string[];
  classIds: string[];
  isPrn?: boolean;
  /** The instruction in force right now. Absent if the medicine has no instruction yet. */
  currentInstruction?: InstructionSnapshot;
  /** The very first instruction ever confirmed for this medicine (same row as current if never changed). */
  firstInstruction?: InstructionSnapshot;
  /** Whether an active MedicationSchedule row exists for this medicine. */
  hasActiveSchedule?: boolean;
  /**
   * The prescription this medicine was recorded against, if any (P2-3).
   * Additive: snapshots without it behave exactly as before — the
   * multi-prescription rule simply has nothing to compare.
   */
  prescription?: PrescriptionSnapshot;
}

export interface AllergySnapshot {
  id: string;
  label: string;
  allergenIngredientId: string | null;
}

export type Severity = FindingSeverity;

export interface RawFinding {
  category: string;
  severity: Severity;
  medicationIds: string[];
  ruleKey: string;
  ruleVersion: string;
  sourceName: string;
  explanationKey: string;
  detail: Record<string, unknown>;
}

/** Rule keys + versions are code constants — see the schema comment for why. */
export const RULE_VERSIONS = {
  exactDuplicate: { key: "duplicate-ingredient-exact", version: "1" },
  partialDuplicate: { key: "duplicate-ingredient-partial", version: "1" },
  classDuplicate: { key: "duplicate-therapeutic-class", version: "1" },
  allergyMatch: { key: "allergy-ingredient-match", version: "1" },
  uncertainNormalization: { key: "uncertain-normalization", version: "1" },
  scheduleConflictMissing: { key: "schedule-conflict-missing", version: "1" },
  scheduleConflictPrn: { key: "schedule-conflict-prn", version: "1" },
  doseDiffers: { key: "dose-differs-from-prescription", version: "1" },
  // Phase 2 (docs_v2/06 P2-3)
  multipleActivePrescriptions: { key: "multiple-active-prescriptions", version: "1" },
  conflictingInstructions: { key: "conflicting-instructions", version: "1" },
} as const;

/** Source names recorded on every finding for traceability (docs_v2/10 §3). */
export const CATALOG_SOURCE = "internal-catalog-normalization";
export const ALLERGY_SOURCE = "patient-reported-allergy";
export const SCHEDULE_SOURCE = "patient-medication-schedule";
export const INSTRUCTION_HISTORY_SOURCE = "patient-instruction-history";
export const PRESCRIPTION_RECORDS_SOURCE = "patient-prescription-records";
export const CURRENT_INSTRUCTIONS_SOURCE = "patient-current-instructions";

/** Order-independent key for a pair of medication ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Order-independent key for a medicine's normalized ingredient set, or null
 * when the set is empty (a confirmed product with no ingredients on file has
 * nothing to compare — it is skipped, never guessed).
 */
export function ingredientSetKey(med: MedicationSnapshot): string | null {
  if (med.ingredientIds.length === 0) return null;
  return [...new Set(med.ingredientIds)].sort().join("+");
}

/** Groups confirmed medicines by ingredient set; groups of one are dropped. */
export function groupByIngredientSet(medications: MedicationSnapshot[]): MedicationSnapshot[][] {
  const groups = new Map<string, MedicationSnapshot[]>();
  for (const med of medications) {
    const key = ingredientSetKey(med);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(med);
    groups.set(key, list);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}

/**
 * Human-readable rendering of an instruction for explanations: the original
 * captured text verbatim when there is one, else "1 tablet BD" / "1 tablet 1-0-1".
 */
export function renderInstruction(instruction: InstructionSnapshot): string {
  if (instruction.originalText && instruction.originalText.trim()) return instruction.originalText.trim();
  const parts = [String(instruction.doseQuantity)];
  if (instruction.doseUnit) parts.push(instruction.doseUnit);
  parts.push(instruction.pattern ?? instruction.frequencyCode);
  return parts.join(" ");
}
