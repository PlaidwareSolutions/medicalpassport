import { describe, expect, it } from "vitest";
import { evaluateSafety } from "./evaluate.js";
import type { AllergySnapshot, MedicationSnapshot } from "./types.js";

function med(overrides: Partial<MedicationSnapshot> & { id: string; name: string }): MedicationSnapshot {
  return {
    normalizationStatus: "confirmed",
    isCombination: false,
    ingredientIds: [],
    ingredientNames: [],
    classIds: [],
    // Assume properly scheduled unless a test is specifically exercising
    // the schedule-conflict rule — most tests here aren't about scheduling.
    hasActiveSchedule: true,
    ...overrides,
  };
}

describe("evaluateSafety", () => {
  it("flags exact duplication when two single-ingredient medicines share an ingredient", () => {
    const meds = [
      med({ id: "a", name: "Glycomet", ingredientIds: ["metformin"], ingredientNames: ["Metformin"] }),
      med({ id: "b", name: "Glyciphage", ingredientIds: ["metformin"], ingredientNames: ["Metformin"] }),
    ];
    const findings = evaluateSafety(meds, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "exact_ingredient_duplication", severity: "high" });
    expect(findings[0]!.medicationIds.sort()).toEqual(["a", "b"]);
  });

  it("flags partial duplication when a combination product shares an ingredient with another medicine", () => {
    const meds = [
      med({ id: "a", name: "Telma", ingredientIds: ["telmisartan"], ingredientNames: ["Telmisartan"] }),
      med({
        id: "b",
        name: "Telma-AM",
        isCombination: true,
        ingredientIds: ["telmisartan", "amlodipine"],
        ingredientNames: ["Telmisartan", "Amlodipine"],
      }),
    ];
    const findings = evaluateSafety(meds, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("partial_ingredient_duplication");
    expect(findings[0]!.severity).toBe("moderate");
  });

  it("flags therapeutic-class duplication only when not already covered by an ingredient finding", () => {
    const meds = [
      med({ id: "a", name: "Amlong", ingredientIds: ["amlodipine"], ingredientNames: ["Amlodipine"], classIds: ["ccb"] }),
      med({ id: "b", name: "Generic CCB", ingredientIds: ["nifedipine"], ingredientNames: ["Nifedipine"], classIds: ["ccb"] }),
    ];
    const findings = evaluateSafety(meds, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("therapeutic_class_duplication");
    expect(findings[0]!.severity).toBe("low");
  });

  it("does not double-flag class duplication for a pair already caught by exact duplication", () => {
    const meds = [
      med({ id: "a", name: "Glycomet", ingredientIds: ["metformin"], ingredientNames: ["Metformin"], classIds: ["biguanide"] }),
      med({ id: "b", name: "Glyciphage", ingredientIds: ["metformin"], ingredientNames: ["Metformin"], classIds: ["biguanide"] }),
    ];
    const findings = evaluateSafety(meds, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("exact_ingredient_duplication");
  });

  it("flags a drug-allergy match", () => {
    const meds = [med({ id: "a", name: "Amoxicillin", ingredientIds: ["amoxicillin"], ingredientNames: ["Amoxicillin"] })];
    const allergies: AllergySnapshot[] = [{ id: "al1", label: "Penicillin", allergenIngredientId: "amoxicillin" }];
    const findings = evaluateSafety(meds, allergies);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "drug_allergy", severity: "high", medicationIds: ["a"] });
  });

  it("ignores allergies with no normalized ingredient (never guesses)", () => {
    const meds = [med({ id: "a", name: "Amoxicillin", ingredientIds: ["amoxicillin"], ingredientNames: ["Amoxicillin"] })];
    const allergies: AllergySnapshot[] = [{ id: "al1", label: "Something I reacted to once", allergenIngredientId: null }];
    expect(evaluateSafety(meds, allergies)).toHaveLength(0);
  });

  it("flags uncertain normalization for unmatched free-text entries without skipping them silently", () => {
    const meds = [med({ id: "a", name: "Some tablet", normalizationStatus: "unmatched" })];
    const findings = evaluateSafety(meds, []);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "uncertain_normalization", severity: "info" });
  });

  it("excludes unmatched medicines from duplicate checks (only confirmed matches are compared)", () => {
    const meds = [
      med({ id: "a", name: "Confirmed Metformin", ingredientIds: ["metformin"], ingredientNames: ["Metformin"] }),
      med({
        id: "b",
        name: "Unconfirmed entry",
        normalizationStatus: "unmatched",
        ingredientIds: ["metformin"],
        ingredientNames: ["Metformin"],
      }),
    ];
    const findings = evaluateSafety(meds, []);
    // No exact-duplicate finding (b isn't checkable) — only b's own uncertain-normalization finding.
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("uncertain_normalization");
  });

  it("returns nothing for a single well-matched medicine with no allergies", () => {
    const meds = [med({ id: "a", name: "Dolo 650", ingredientIds: ["paracetamol"], ingredientNames: ["Paracetamol"] })];
    expect(evaluateSafety(meds, [])).toHaveLength(0);
  });

  describe("schedule conflicts", () => {
    it("flags a fixed-frequency medicine with no active schedule", () => {
      const meds = [
        med({
          id: "a",
          name: "Amlong",
          currentInstruction: { doseQuantity: 1, frequencyCode: "OD", pattern: null },
          hasActiveSchedule: false,
        }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ category: "schedule_conflict", severity: "moderate", medicationIds: ["a"] });
      expect(findings[0]!.explanationKey).toBe("safety.explain.schedule_conflict_missing");
    });

    it("flags a PRN medicine that still has an active schedule", () => {
      const meds = [
        med({
          id: "a",
          name: "Paracetamol",
          isPrn: true,
          currentInstruction: { doseQuantity: 1, frequencyCode: "SOS", pattern: null },
          hasActiveSchedule: true,
        }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ category: "schedule_conflict", severity: "low", medicationIds: ["a"] });
      expect(findings[0]!.explanationKey).toBe("safety.explain.schedule_conflict_prn");
    });

    it("does not flag a fixed-frequency medicine that has its schedule", () => {
      const meds = [
        med({
          id: "a",
          name: "Amlong",
          currentInstruction: { doseQuantity: 1, frequencyCode: "OD", pattern: null },
          hasActiveSchedule: true,
        }),
      ];
      expect(evaluateSafety(meds, [])).toHaveLength(0);
    });

    it("does not flag a frequency that's never auto-scheduled even without a schedule (e.g. SOS)", () => {
      const meds = [
        med({
          id: "a",
          name: "Paracetamol",
          currentInstruction: { doseQuantity: 1, frequencyCode: "SOS", pattern: null },
          hasActiveSchedule: false,
        }),
      ];
      expect(evaluateSafety(meds, [])).toHaveLength(0);
    });

    it("does not flag a PRN medicine with no schedule (the expected, correct state)", () => {
      const meds = [
        med({
          id: "a",
          name: "Paracetamol",
          isPrn: true,
          currentInstruction: { doseQuantity: 1, frequencyCode: "SOS", pattern: null },
          hasActiveSchedule: false,
        }),
      ];
      expect(evaluateSafety(meds, [])).toHaveLength(0);
    });
  });

  describe("dose differs from confirmed prescription", () => {
    it("flags a dose quantity that changed since the medicine was first confirmed", () => {
      const meds = [
        med({
          id: "a",
          name: "Amlong",
          firstInstruction: { doseQuantity: 1, frequencyCode: "OD", pattern: null },
          currentInstruction: { doseQuantity: 2, frequencyCode: "OD", pattern: null },
        }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ category: "dose_differs_from_prescription", severity: "moderate", medicationIds: ["a"] });
    });

    it("flags a frequency/pattern change since first confirmed", () => {
      const meds = [
        med({
          id: "a",
          name: "Amlong",
          firstInstruction: { doseQuantity: 1, frequencyCode: "OD", pattern: null },
          currentInstruction: { doseQuantity: 1, frequencyCode: "PATTERN", pattern: "1-0-1" },
        }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.category).toBe("dose_differs_from_prescription");
    });

    it("does not flag a medicine whose instruction has never changed", () => {
      const meds = [
        med({
          id: "a",
          name: "Amlong",
          firstInstruction: { doseQuantity: 1, frequencyCode: "OD", pattern: null },
          currentInstruction: { doseQuantity: 1, frequencyCode: "OD", pattern: null },
        }),
      ];
      expect(evaluateSafety(meds, [])).toHaveLength(0);
    });

    it("does not flag a medicine with no instruction history at all", () => {
      const meds = [med({ id: "a", name: "Amlong" })];
      expect(evaluateSafety(meds, [])).toHaveLength(0);
    });
  });

  // Phase 2 (docs_v2/06 P2-3). Every case below involves two medicines with the
  // same ingredient, so the pre-existing exact-duplication finding is always
  // present too; the assertions pick the new category out explicitly.
  describe("multiple active prescriptions", () => {
    const amlodipine = { ingredientIds: ["amlodipine"], ingredientNames: ["Amlodipine"] };
    const od = { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", pattern: null };
    const byCategory = (findings: ReturnType<typeof evaluateSafety>, category: string) =>
      findings.filter((f) => f.category === category);

    it("flags the same ingredient recorded as current under two different prescriptions", () => {
      const meds = [
        med({
          id: "a",
          name: "Amlong",
          ...amlodipine,
          currentInstruction: od,
          prescription: { id: "p1", prescribedAt: "2026-07-20", practitionerName: "Dr. Sharma" },
        }),
        med({
          id: "b",
          name: "Amlodipine 5",
          ...amlodipine,
          currentInstruction: od,
          prescription: { id: "p2", prescribedAt: "2026-08-02", practitionerName: "Dr. Rao" },
        }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings.map((f) => f.category).sort()).toEqual(["exact_ingredient_duplication", "multiple_active_prescriptions"]);
      const [multi] = byCategory(findings, "multiple_active_prescriptions");
      expect(multi).toMatchObject({
        severity: "moderate",
        ruleKey: "multiple-active-prescriptions",
        ruleVersion: "1",
        explanationKey: "safety.explain.multiple_active_prescriptions",
      });
      expect(multi!.medicationIds.sort()).toEqual(["a", "b"]);
      expect(multi!.detail).toMatchObject({
        medicationNames: ["Amlong", "Amlodipine 5"],
        prescriptionIds: ["p1", "p2"],
        prescriptionLabels: ["Dr. Sharma, 2026-07-20", "Dr. Rao, 2026-08-02"],
        evidence: { medicationIds: ["a", "b"], prescriptionIds: ["p1", "p2"] },
      });
    });

    it("falls back to the medicine name as the label when a prescription has no date or doctor", () => {
      const meds = [
        med({ id: "a", name: "Amlong", ...amlodipine, prescription: { id: "p1" } }),
        med({ id: "b", name: "Amlodipine 5", ...amlodipine, prescription: { id: "p2", prescribedAt: null, practitionerName: null } }),
      ];
      const [multi] = byCategory(evaluateSafety(meds, []), "multiple_active_prescriptions");
      expect(multi!.detail.prescriptionLabels).toEqual(["Amlong", "Amlodipine 5"]);
    });

    it("does not flag two entries that come from the same prescription", () => {
      const meds = [
        med({ id: "a", name: "Amlong", ...amlodipine, prescription: { id: "p1" } }),
        med({ id: "b", name: "Amlodipine 5", ...amlodipine, prescription: { id: "p1" } }),
      ];
      expect(byCategory(evaluateSafety(meds, []), "multiple_active_prescriptions")).toHaveLength(0);
    });

    it("does not flag when only one of the entries has a prescription on file (no prescription is a valid entry)", () => {
      const meds = [
        med({ id: "a", name: "Amlong", ...amlodipine, prescription: { id: "p1" } }),
        med({ id: "b", name: "Amlodipine 5", ...amlodipine }),
      ];
      expect(byCategory(evaluateSafety(meds, []), "multiple_active_prescriptions")).toHaveLength(0);
    });

    it("does not flag different ingredients on different prescriptions", () => {
      const meds = [
        med({ id: "a", name: "Amlong", ...amlodipine, prescription: { id: "p1" } }),
        med({ id: "b", name: "Telma", ingredientIds: ["telmisartan"], ingredientNames: ["Telmisartan"], prescription: { id: "p2" } }),
      ];
      expect(evaluateSafety(meds, [])).toHaveLength(0);
    });

    it("compares the whole ingredient set — a combination is not the same set as one of its parts", () => {
      const meds = [
        med({ id: "a", name: "Telma", ingredientIds: ["telmisartan"], ingredientNames: ["Telmisartan"], prescription: { id: "p1" } }),
        med({
          id: "b",
          name: "Telma-AM",
          isCombination: true,
          ingredientIds: ["telmisartan", "amlodipine"],
          ingredientNames: ["Telmisartan", "Amlodipine"],
          prescription: { id: "p2" },
        }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings.map((f) => f.category)).toEqual(["partial_ingredient_duplication"]);
    });

    it("excludes uncertain normalization exactly as the duplication rules do", () => {
      const meds = [
        med({ id: "a", name: "Amlong", ...amlodipine, prescription: { id: "p1" } }),
        med({ id: "b", name: "Some BP tablet", normalizationStatus: "unmatched", ...amlodipine, prescription: { id: "p2" } }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings.map((f) => f.category)).toEqual(["uncertain_normalization"]);
    });

    it("leaves snapshots without the new prescription field completely unaffected", () => {
      const meds = [med({ id: "a", name: "Amlong", ...amlodipine }), med({ id: "b", name: "Amlodipine 5", ...amlodipine })];
      const findings = evaluateSafety(meds, []);
      expect(findings.map((f) => f.category)).toEqual(["exact_ingredient_duplication"]);
    });
  });

  describe("conflicting instructions", () => {
    const paracetamol = { ingredientIds: ["paracetamol"], ingredientNames: ["Paracetamol"] };
    const byCategory = (findings: ReturnType<typeof evaluateSafety>, category: string) =>
      findings.filter((f) => f.category === category);

    it("flags the same ingredient recorded with different dose quantities, quoting both instructions", () => {
      const meds = [
        med({
          id: "a",
          name: "Dolo 650",
          ...paracetamol,
          currentInstruction: { id: "i1", doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", pattern: null },
        }),
        med({
          id: "b",
          name: "Calpol 650",
          ...paracetamol,
          currentInstruction: { id: "i2", doseQuantity: 2, doseUnit: "tablet", frequencyCode: "BD", pattern: null },
        }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings.map((f) => f.category).sort()).toEqual(["conflicting_instructions", "exact_ingredient_duplication"]);
      const [conflict] = byCategory(findings, "conflicting_instructions");
      expect(conflict).toMatchObject({
        severity: "moderate",
        ruleKey: "conflicting-instructions",
        ruleVersion: "1",
        explanationKey: "safety.explain.conflicting_instructions",
      });
      expect(conflict!.medicationIds.sort()).toEqual(["a", "b"]);
      expect(conflict!.detail).toMatchObject({
        medicationNames: ["Dolo 650", "Calpol 650"],
        instructionTexts: ["1 tablet BD", "2 tablet BD"],
        evidence: { medicationIds: ["a", "b"], instructionIds: ["i1", "i2"] },
      });
    });

    it("flags a frequency difference and quotes the original captured text verbatim when present", () => {
      const meds = [
        med({
          id: "a",
          name: "Dolo 650",
          ...paracetamol,
          currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", pattern: null, originalText: "1 tab BD x 5 days" },
        }),
        med({
          id: "b",
          name: "Calpol 650",
          ...paracetamol,
          currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-1-1" },
        }),
      ];
      const [conflict] = byCategory(evaluateSafety(meds, []), "conflicting_instructions");
      expect(conflict!.detail.instructionTexts).toEqual(["1 tab BD x 5 days", "1 tablet 1-1-1"]);
      expect(conflict!.detail.evidence).toEqual({ medicationIds: ["a", "b"], instructionIds: [] });
    });

    it("flags a dose-unit difference even when the quantity and frequency match", () => {
      const meds = [
        med({ id: "a", name: "Crocin", ...paracetamol, currentInstruction: { doseQuantity: 5, doseUnit: "ml", frequencyCode: "TDS", pattern: null } }),
        med({ id: "b", name: "Dolo", ...paracetamol, currentInstruction: { doseQuantity: 5, doseUnit: "tablet", frequencyCode: "TDS", pattern: null } }),
      ];
      expect(byCategory(evaluateSafety(meds, []), "conflicting_instructions")).toHaveLength(1);
    });

    it("does not flag two entries with the same instruction", () => {
      const same = { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", pattern: null };
      const meds = [
        med({ id: "a", name: "Dolo 650", ...paracetamol, currentInstruction: { ...same } }),
        med({ id: "b", name: "Calpol 650", ...paracetamol, currentInstruction: { ...same } }),
      ];
      expect(byCategory(evaluateSafety(meds, []), "conflicting_instructions")).toHaveLength(0);
    });

    it("does not compare an as-needed entry against a scheduled one (the PRN designation is the difference)", () => {
      const meds = [
        med({ id: "a", name: "Dolo 650", ...paracetamol, currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "TDS", pattern: null } }),
        med({
          id: "b",
          name: "Calpol 650",
          ...paracetamol,
          isPrn: true,
          hasActiveSchedule: false,
          currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "SOS", pattern: null },
        }),
      ];
      const findings = evaluateSafety(meds, []);
      expect(findings.map((f) => f.category)).toEqual(["exact_ingredient_duplication"]);
    });

    it("does compare two as-needed entries with each other", () => {
      const meds = [
        med({
          id: "a",
          name: "Dolo 650",
          ...paracetamol,
          isPrn: true,
          hasActiveSchedule: false,
          currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "SOS", pattern: null },
        }),
        med({
          id: "b",
          name: "Calpol 650",
          ...paracetamol,
          isPrn: true,
          hasActiveSchedule: false,
          currentInstruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "SOS", pattern: null },
        }),
      ];
      const [conflict] = byCategory(evaluateSafety(meds, []), "conflicting_instructions");
      expect(conflict!.detail.instructionTexts).toEqual(["1 tablet SOS", "2 tablet SOS"]);
    });

    it("does not flag when one entry has no current instruction to compare", () => {
      const meds = [
        med({ id: "a", name: "Dolo 650", ...paracetamol, currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", pattern: null } }),
        med({ id: "b", name: "Calpol 650", ...paracetamol }),
      ];
      expect(byCategory(evaluateSafety(meds, []), "conflicting_instructions")).toHaveLength(0);
    });

    it("excludes uncertain normalization exactly as the duplication rules do", () => {
      const meds = [
        med({ id: "a", name: "Dolo 650", ...paracetamol, currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", pattern: null } }),
        med({
          id: "b",
          name: "Some fever tablet",
          normalizationStatus: "unmatched",
          ...paracetamol,
          currentInstruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "BD", pattern: null },
        }),
      ];
      expect(evaluateSafety(meds, []).map((f) => f.category)).toEqual(["uncertain_normalization"]);
    });

    it("does not need a prescription on either side — two manual entries with different instructions still conflict", () => {
      const meds = [
        med({ id: "a", name: "Dolo 650", ...paracetamol, currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", pattern: null } }),
        med({ id: "b", name: "Calpol 650", ...paracetamol, currentInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", pattern: null } }),
      ];
      expect(byCategory(evaluateSafety(meds, []), "conflicting_instructions")).toHaveLength(1);
    });
  });
});
