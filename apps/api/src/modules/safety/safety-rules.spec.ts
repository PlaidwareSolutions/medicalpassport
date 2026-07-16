import { evaluateSafety, type AllergySnapshot, type MedicationSnapshot } from "./safety-rules";

function med(overrides: Partial<MedicationSnapshot> & { id: string; name: string }): MedicationSnapshot {
  return {
    normalizationStatus: "confirmed",
    isCombination: false,
    ingredientIds: [],
    ingredientNames: [],
    classIds: [],
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
});
