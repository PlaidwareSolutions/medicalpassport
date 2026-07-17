/**
 * Deterministic safety rules — Stage 6 (docs/09). Pure functions over a
 * normalized snapshot of a profile's current medications; no I/O, so the
 * detection logic itself is directly unit-testable.
 *
 * Scope this pass: exact/partial ingredient duplication, therapeutic-class
 * duplication, drug-allergy, uncertain-normalization, schedule conflict,
 * and dose-differs-from-prescription. Drug-drug interaction, drug-condition,
 * food, and alcohol checks need a licensed data source (OD-4) or
 * clinically-reviewed content that doesn't exist yet — never fabricated
 * (docs/19).
 *
 * docs/09 names "schedule conflict" and "dose differs from confirmed
 * prescription" as categories 9–10 but doesn't define their mechanics —
 * unlike the interaction/allergy checks, no external spec pins these down.
 * Both are defined here purely from data the app already has, never
 * fabricated: a schedule conflict is the reminder schedule not matching
 * what the confirmed instruction implies it should be (missing entirely,
 * or present despite being PRN); dose-differs compares the medicine's
 * first-ever confirmed instruction against its current one. Both flag for
 * confirmation only — never a recommendation to act (docs/02).
 */

const AUTO_SCHEDULABLE_FREQUENCIES = new Set(["OD", "BD", "TDS", "HS", "PATTERN"]);

export interface InstructionSnapshot {
  doseQuantity: number;
  frequencyCode: string;
  pattern: string | null;
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
}

export interface AllergySnapshot {
  id: string;
  label: string;
  allergenIngredientId: string | null;
}

export type Severity = "info" | "low" | "moderate" | "high";

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
} as const;

const CATALOG_SOURCE = "internal-catalog-normalization";
const ALLERGY_SOURCE = "patient-reported-allergy";
const SCHEDULE_SOURCE = "patient-medication-schedule";
const INSTRUCTION_HISTORY_SOURCE = "patient-instruction-history";

export function evaluateSafety(medications: MedicationSnapshot[], allergies: AllergySnapshot[]): RawFinding[] {
  const findings: RawFinding[] = [];
  const checkable = medications.filter((m) => m.normalizationStatus === "confirmed");

  findings.push(...findIngredientDuplicates(checkable));
  findings.push(...findClassDuplicates(checkable, findings));
  findings.push(...findAllergyMatches(checkable, allergies));
  findings.push(...findUncertainNormalization(medications));
  findings.push(...findScheduleConflicts(medications));
  findings.push(...findDoseDiffersFromPrescription(medications));

  return findings;
}

function findIngredientDuplicates(medications: MedicationSnapshot[]): RawFinding[] {
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

function findClassDuplicates(medications: MedicationSnapshot[], existing: RawFinding[]): RawFinding[] {
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

function findAllergyMatches(medications: MedicationSnapshot[], allergies: AllergySnapshot[]): RawFinding[] {
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

function findUncertainNormalization(medications: MedicationSnapshot[]): RawFinding[] {
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

/**
 * Flags a mismatch between the confirmed instruction and the actual
 * reminder schedule: a fixed-frequency medicine with no active schedule
 * (so the patient isn't being reminded at all) or a PRN medicine that
 * somehow still has one (docs/16: PRN medicines generate no scheduled
 * reminders). Both indicate the schedule and the instruction disagree —
 * never a clinical judgment, just an internal-consistency check.
 */
function findScheduleConflicts(medications: MedicationSnapshot[]): RawFinding[] {
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

/**
 * Compares the medicine's very first confirmed instruction against the one
 * in force now. Instructions are copy-on-write (docs/13), so this is a
 * simple, honest diff over the patient's own recorded history — never an
 * inference about whether a doctor actually authorized the change (docs/09:
 * dose/frequency changes are always attributed to the patient's own
 * recording, this only surfaces that a change happened at all).
 */
function findDoseDiffersFromPrescription(medications: MedicationSnapshot[]): RawFinding[] {
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

function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}
