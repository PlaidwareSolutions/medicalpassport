import { afterEach, describe, expect, it, vi } from "vitest";
import { extractForKind, fetchClinicalContent, fetchCombinationClinicalContent, matchesCombination, pickBestCombinationLabel, pickBestLabel } from "./index.js";

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SINGLE_INGREDIENT_LABEL = {
  id: "label-1",
  set_id: "set-metformin-1",
  effective_time: "20240115",
  indications_and_usage: ["Metformin is indicated to improve glycemic control in adults with type 2 diabetes mellitus."],
  how_supplied: ["16 HOW SUPPLIED/STORAGE AND HANDLING Store at 20 to 25 C. Dispense in a tight container."],
  warnings_and_cautions: ["5 WARNINGS AND PRECAUTIONS Lactic acidosis: a rare but serious metabolic complication."],
  information_for_patients: [
    "Instructions for Patients Advise patients to take with food. If a dose is missed, take it as soon as remembered, but skip it if the next dose is nearly due; do not double up. Avoid excessive alcohol intake while taking this medicine, since it increases the risk of lactic acidosis.",
  ],
  drug_interactions: ["Table 4 presents clinically significant drug interactions."],
  openfda: { generic_name: ["METFORMIN HYDROCHLORIDE"], substance_name: ["METFORMIN HYDROCHLORIDE"] },
};

const COMBINATION_LABEL = {
  id: "label-2",
  set_id: "set-combo-1",
  effective_time: "20240301",
  indications_and_usage: ["This fixed-dose combination is indicated as an adjunct to diet and exercise..."],
  openfda: { generic_name: ["SITAGLIPTIN", "METFORMIN HYDROCHLORIDE"], substance_name: ["SITAGLIPTIN", "METFORMIN HYDROCHLORIDE"] },
};

describe("pickBestLabel (pure, no network)", () => {
  it("picks a clean single-ingredient label", () => {
    expect(pickBestLabel({ results: [SINGLE_INGREDIENT_LABEL] })?.set_id).toBe("set-metformin-1");
  });

  it("rejects a combination-product label even when it's the only result", () => {
    expect(pickBestLabel({ results: [COMBINATION_LABEL] })).toBeNull();
  });

  it("prefers a single-ingredient label over a combination one, regardless of order", () => {
    expect(pickBestLabel({ results: [COMBINATION_LABEL, SINGLE_INGREDIENT_LABEL] })?.set_id).toBe("set-metformin-1");
  });

  it("prefers the most recently effective label among several valid candidates", () => {
    const older = { ...SINGLE_INGREDIENT_LABEL, set_id: "set-older", effective_time: "20100101" };
    const newer = { ...SINGLE_INGREDIENT_LABEL, set_id: "set-newer", effective_time: "20250601" };
    expect(pickBestLabel({ results: [older, newer] })?.set_id).toBe("set-newer");
  });

  it("returns null for zero results or a result missing the openfda block", () => {
    expect(pickBestLabel({ results: [] })).toBeNull();
    expect(pickBestLabel({ results: [{ ...SINGLE_INGREDIENT_LABEL, openfda: undefined }] })).toBeNull();
  });
});

describe("extractForKind (pure, no network)", () => {
  it("education: whole-section grab, high confidence", () => {
    const result = extractForKind(SINGLE_INGREDIENT_LABEL, "education");
    expect(result!.text).toContain("type 2 diabetes");
    expect(result!.lowConfidence).toBe(false);
  });

  it("storage: whole-section grab from how_supplied, high confidence", () => {
    const result = extractForKind(SINGLE_INGREDIENT_LABEL, "storage");
    expect(result!.text).toContain("Store at 20 to 25");
    expect(result!.lowConfidence).toBe(false);
  });

  it("warning_symptoms: whole-section grab from warnings_and_cautions, high confidence", () => {
    const result = extractForKind(SINGLE_INGREDIENT_LABEL, "warning_symptoms");
    expect(result!.text).toContain("Lactic acidosis");
    expect(result!.lowConfidence).toBe(false);
  });

  it("food_alcohol: keyword-windowed extraction from information_for_patients, low confidence", () => {
    const result = extractForKind(SINGLE_INGREDIENT_LABEL, "food_alcohol");
    expect(result!.text.toLowerCase()).toContain("alcohol");
    expect(result!.lowConfidence).toBe(true);
  });

  it("missed_dose: keyword-windowed extraction from information_for_patients, low confidence", () => {
    const result = extractForKind(SINGLE_INGREDIENT_LABEL, "missed_dose");
    expect(result!.text.toLowerCase()).toContain("missed");
    expect(result!.lowConfidence).toBe(true);
  });

  it("returns null (never fabricates) when a section is simply absent", () => {
    const bare = { ...SINGLE_INGREDIENT_LABEL, how_supplied: undefined, information_for_patients: undefined };
    expect(extractForKind(bare, "storage")).toBeNull();
    expect(extractForKind(bare, "food_alcohol")).toBeNull();
    expect(extractForKind(bare, "missed_dose")).toBeNull();
  });

  it("food_alcohol falls back to drug_interactions when information_for_patients has no alcohol/grapefruit mention", () => {
    const noAlcoholInPatientInfo = {
      ...SINGLE_INGREDIENT_LABEL,
      information_for_patients: ["Take with food. Report any unusual symptoms to your doctor."],
      drug_interactions: ["Concomitant alcohol use may increase drowsiness with this medicine."],
    };
    const result = extractForKind(noAlcoholInPatientInfo, "food_alcohol");
    expect(result!.text.toLowerCase()).toContain("alcohol");
    expect(result!.section).toBe("drug_interactions");
  });

  it("returns null when no keyword appears anywhere for the fragile kinds", () => {
    const noMentionAtAll = { ...SINGLE_INGREDIENT_LABEL, information_for_patients: ["Take with a full glass of water."], drug_interactions: ["No known interactions."] };
    expect(extractForKind(noMentionAtAll, "food_alcohol")).toBeNull();
    expect(extractForKind(noMentionAtAll, "missed_dose")).toBeNull();
  });

  it("keyword-window extraction never starts or ends mid-sentence", () => {
    const result = extractForKind(SINGLE_INGREDIENT_LABEL, "missed_dose");
    // Must be a clean sentence boundary, not an arbitrary character cut.
    expect(result!.text.startsWith("If a dose is missed")).toBe(true);
  });
});

describe("fetchClinicalContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a result on the ingredient's own name without needing synonyms", async () => {
    mockFetchOnce(200, { results: [SINGLE_INGREDIENT_LABEL] });
    const result = await fetchClinicalContent("education", "Metformin", ["Glucophage"]);
    expect(result!.text).toContain("type 2 diabetes");
    expect(result!.lowConfidence).toBe(false);
  });

  it("falls back through synonyms — the Paracetamol/Acetaminophen INN vs. US-name gap", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.toLowerCase().includes("paracetamol")) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ results: [SINGLE_INGREDIENT_LABEL] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchClinicalContent("education", "Paracetamol", ["Acetaminophen"]);
    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null (never fabricates) when no name or synonym yields a confident match for this kind", async () => {
    mockFetchOnce(404, {});
    const result = await fetchClinicalContent("storage", "SomeUnknownIngredient", ["AlsoUnknown"]);
    expect(result).toBeNull();
  });

  it("continues to the next synonym when a label matches but has nothing for this specific kind", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.toLowerCase().includes("firstname")) {
        return { ok: true, status: 200, json: async () => ({ results: [{ ...SINGLE_INGREDIENT_LABEL, how_supplied: undefined }] }) };
      }
      return { ok: true, status: 200, json: async () => ({ results: [SINGLE_INGREDIENT_LABEL] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchClinicalContent("storage", "FirstName", ["SecondName"]);
    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a 5xx/429 response instead of returning null, so job-queue retry can distinguish it from 'no data'", async () => {
    mockFetchOnce(429, { error: "rate limited" });
    await expect(fetchClinicalContent("education", "Metformin")).rejects.toThrow(/openfda_http_429/);
  });
});

// Real, live-confirmed shape: openFDA has an actual "TELMISARTAN AND
// AMLODIPINE" combination label with substance_name ["TELMISARTAN",
// "AMLODIPINE BESYLATE"] — the seed catalog's one real combination product
// (Telma-AM) is exactly this pair.
const TELMA_AM_LABEL = {
  id: "combo-label-1",
  set_id: "set-telma-am-1",
  effective_time: "20240601",
  indications_and_usage: ["Telmisartan and amlodipine tablets are indicated for the treatment of hypertension."],
  openfda: { generic_name: ["TELMISARTAN AND AMLODIPINE"], substance_name: ["TELMISARTAN", "AMLODIPINE BESYLATE"] },
};

describe("matchesCombination / pickBestCombinationLabel (pure, no network)", () => {
  it("matches the real Telma-AM label against its own two ingredient names, salt-form suffix and all", () => {
    expect(matchesCombination(TELMA_AM_LABEL, ["Telmisartan", "Amlodipine"])).toBe(true);
  });

  it("rejects a label whose substance count doesn't match the product's ingredient count", () => {
    expect(matchesCombination(TELMA_AM_LABEL, ["Telmisartan", "Amlodipine", "Hydrochlorothiazide"])).toBe(false);
    expect(matchesCombination(SINGLE_INGREDIENT_LABEL, ["Telmisartan", "Amlodipine"])).toBe(false);
  });

  it("rejects an ambiguous existential-only match that has no valid one-to-one pairing", () => {
    // "A" and "AB" each prefix-match "ABC" individually, but neither
    // prefix-matches "XYZ" — an existential check ("each name matches
    // something") would wrongly pass; a true bijection correctly can't
    // pair both names to two distinct substances, so it must fail.
    const ambiguousLabel = { ...TELMA_AM_LABEL, openfda: { substance_name: ["ABC", "XYZ"] } };
    expect(matchesCombination(ambiguousLabel, ["A", "AB"])).toBe(false);
  });

  it("rejects a label with no openfda block", () => {
    expect(matchesCombination({ ...TELMA_AM_LABEL, openfda: undefined }, ["Telmisartan", "Amlodipine"])).toBe(false);
  });

  it("pickBestCombinationLabel filters a mixed response down to only the matching combination, ignoring unrelated single-ingredient and other-combination labels", () => {
    const wrongCombo = { ...TELMA_AM_LABEL, id: "wrong", set_id: "set-wrong", openfda: { substance_name: ["TELMISARTAN", "HYDROCHLOROTHIAZIDE"] } };
    const result = pickBestCombinationLabel({ results: [SINGLE_INGREDIENT_LABEL, wrongCombo, TELMA_AM_LABEL] }, ["Telmisartan", "Amlodipine"]);
    expect(result?.set_id).toBe("set-telma-am-1");
  });

  it("prefers the most recently effective matching label", () => {
    const older = { ...TELMA_AM_LABEL, set_id: "set-older", effective_time: "20100101" };
    const newer = { ...TELMA_AM_LABEL, set_id: "set-newer", effective_time: "20250601" };
    const result = pickBestCombinationLabel({ results: [older, newer] }, ["Telmisartan", "Amlodipine"]);
    expect(result?.set_id).toBe("set-newer");
  });
});

describe("fetchCombinationClinicalContent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null (hard cap) for anything other than exactly 2 ingredients", async () => {
    const three = await fetchCombinationClinicalContent("education", [
      { name: "Telmisartan", synonyms: [] },
      { name: "Amlodipine", synonyms: [] },
      { name: "Hydrochlorothiazide", synonyms: [] },
    ]);
    expect(three).toBeNull();
    const one = await fetchCombinationClinicalContent("education", [{ name: "Telmisartan", synonyms: [] }]);
    expect(one).toBeNull();
  });

  it("finds the combination label via the first ingredient's own name search, reusing the same per-name query loop", async () => {
    mockFetchOnce(200, { results: [TELMA_AM_LABEL] });
    const result = await fetchCombinationClinicalContent("education", [
      { name: "Telmisartan", synonyms: [] },
      { name: "Amlodipine", synonyms: [] },
    ]);
    expect(result).not.toBeNull();
    expect(result!.text).toContain("hypertension");
    expect(result!.sourceCitation).toContain("set-telma-am-1");
  });

  it("falls back to the second ingredient's name, and then to synonyms, when the first ingredient's own searches find nothing", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.toLowerCase().includes("telmisartan")) return { ok: true, status: 200, json: async () => ({ results: [] }) };
      if (url.toLowerCase().includes("amlodipine-synonym")) return { ok: true, status: 200, json: async () => ({ results: [TELMA_AM_LABEL] }) };
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCombinationClinicalContent("education", [
      { name: "Telmisartan", synonyms: [] },
      { name: "Amlodipine", synonyms: ["Amlodipine-Synonym"] },
    ]);
    expect(result).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null when no query surfaces a validated match for this exact pair", async () => {
    mockFetchOnce(200, { results: [SINGLE_INGREDIENT_LABEL] });
    const result = await fetchCombinationClinicalContent("education", [
      { name: "Telmisartan", synonyms: [] },
      { name: "Amlodipine", synonyms: [] },
    ]);
    expect(result).toBeNull();
  });

  it("marks food_alcohol/missed_dose extraction from a combination label lowConfidence too, same as single-ingredient", async () => {
    const comboWithPatientInfo = {
      ...TELMA_AM_LABEL,
      information_for_patients: ["Avoid excessive alcohol intake while taking this combination."],
    };
    mockFetchOnce(200, { results: [comboWithPatientInfo] });
    const result = await fetchCombinationClinicalContent("food_alcohol", [
      { name: "Telmisartan", synonyms: [] },
      { name: "Amlodipine", synonyms: [] },
    ]);
    expect(result!.lowConfidence).toBe(true);
  });
});
