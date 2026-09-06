import { describe, expect, it } from "vitest";
import { detectCandidates, type DetectedCandidate } from "./candidate-detection";

/** In-memory stand-in for the `medicationProduct` + `brand` rows ocr-extraction.ts maps into the catalog. */
const catalog = [
  { id: "prod-glycomet", brandName: "Glycomet", brandAliases: ["Glycomet-SR"], genericName: "Metformin" },
  { id: "prod-amlong", brandName: "Amlong", brandAliases: [], genericName: "Amlodipine" },
  { id: "prod-dolo", brandName: null, brandAliases: ["Dolo 650"], genericName: "Paracetamol" },
  // A brand whose names are too short to be safe substrings — must never match.
  { id: "prod-short", brandName: "OD", brandAliases: ["Ab"], genericName: "Short-name trap" },
];

function byField(candidates: DetectedCandidate[], field: DetectedCandidate["field"]): DetectedCandidate | undefined {
  return candidates.find((c) => c.field === field);
}

describe("detectCandidates — brand matching", () => {
  it("matches a catalog brand name case-insensitively and proposes the product id", () => {
    const result = detectCandidates("Tab. GLYCOMET 500mg", catalog);
    expect(byField(result, "brand_name")).toEqual({
      field: "brand_name",
      detectedText: "Tab. GLYCOMET 500mg",
      proposedValue: "prod-glycomet",
      confidence: 0.9,
    });
  });

  it("matches a brand alias when the product has no primary brand name", () => {
    const result = detectCandidates("dolo 650 sos for fever", catalog);
    expect(byField(result, "brand_name")?.proposedValue).toBe("prod-dolo");
  });

  it("keeps the source line verbatim (trimmed) as detectedText", () => {
    const result = detectCandidates("   Amlong 5 mg   \n", catalog);
    expect(byField(result, "brand_name")?.detectedText).toBe("Amlong 5 mg");
  });

  it("never matches names shorter than three characters", () => {
    // "OD" would otherwise substring-match half of every prescription.
    const result = detectCandidates("Tab Something 1 OD\nAb initio", catalog);
    expect(byField(result, "brand_name")).toBeUndefined();
  });

  it("does not match on generic (ingredient) names — brand only", () => {
    const result = detectCandidates("Metformin 500 mg", catalog);
    expect(byField(result, "brand_name")).toBeUndefined();
  });

  it("keeps a single brand candidate — the first match at equal confidence wins", () => {
    const result = detectCandidates("Glycomet 500\nAmlong 5", catalog);
    const brands = result.filter((c) => c.field === "brand_name");
    expect(brands).toHaveLength(1);
    expect(brands[0]?.proposedValue).toBe("prod-glycomet");
  });

  it("returns nothing for an empty catalog", () => {
    expect(byField(detectCandidates("Glycomet 500", []), "brand_name")).toBeUndefined();
  });
});

describe("detectCandidates — frequency", () => {
  it("detects a morning-midday-night slot pattern with higher confidence than an abbreviation", () => {
    const result = detectCandidates("Glycomet 500 1-0-1", catalog);
    expect(byField(result, "frequency")).toEqual({
      field: "frequency",
      detectedText: "Glycomet 500 1-0-1",
      proposedValue: "PATTERN:1-0-1",
      confidence: 0.85,
    });
  });

  it("accepts half-tablet decimals in the pattern", () => {
    expect(byField(detectCandidates("0.5-0-0.5", catalog), "frequency")?.proposedValue).toBe("PATTERN:0.5-0-0.5");
  });

  it("rejects an all-zero pattern instead of proposing it", () => {
    expect(byField(detectCandidates("Tab X 0-0-0", catalog), "frequency")).toBeUndefined();
  });

  it.each([
    ["OD", "OD"],
    ["bd", "BD"],
    ["TDS", "TDS"],
    ["tid", "TDS"],
    ["QID", "QID"],
    ["sos", "SOS"],
    ["HS", "HS"],
  ])("maps the abbreviation %s to frequency code %s at 0.75 confidence", (abbrev, code) => {
    const line = `Tab Amlong 5mg ${abbrev}`;
    expect(byField(detectCandidates(line, catalog), "frequency")).toEqual({
      field: "frequency",
      detectedText: line,
      proposedValue: code,
      confidence: 0.75,
    });
  });

  it("only matches abbreviations on word boundaries", () => {
    // "abdomen" contains "bd", "history" contains "hs" — neither is a frequency.
    const result = detectCandidates("Pain in abdomen\nPast history: nil", catalog);
    expect(byField(result, "frequency")).toBeUndefined();
  });

  it("prefers a pattern on one line over an abbreviation on another (single slot per field)", () => {
    const result = detectCandidates("Tab A BD\nTab B 1-1-1", catalog);
    const freqs = result.filter((c) => c.field === "frequency");
    expect(freqs).toHaveLength(1);
    expect(freqs[0]?.proposedValue).toBe("PATTERN:1-1-1");
    expect(freqs[0]?.detectedText).toBe("Tab B 1-1-1");
  });

  it("does not detect prose frequencies like 'twice daily' — those stay manual", () => {
    expect(byField(detectCandidates("Take twice daily", catalog), "frequency")).toBeUndefined();
  });
});

describe("detectCandidates — food instruction", () => {
  it.each([
    ["Take before food", "before"],
    ["with FOOD", "with"],
    ["1 tab after   food", "after"],
    ["at bedtime", "bedtime"],
    ["Take at bed time", "bedtime"],
  ])("detects %j as %s", (line, value) => {
    expect(byField(detectCandidates(line, catalog), "food_instruction")).toEqual({
      field: "food_instruction",
      detectedText: line,
      proposedValue: value,
      confidence: 0.75,
    });
  });

  it("does not treat a bare 'food' or 'bed' as an instruction", () => {
    expect(byField(detectCandidates("Avoid oily food\nBed rest advised", catalog), "food_instruction")).toBeUndefined();
  });
});

describe("detectCandidates — whole-text behaviour", () => {
  it("combines one candidate per field from different lines of the same prescription", () => {
    const text = ["Dr. A. Sharma, MBBS", "Rx", "Tab Glycomet 500mg", "1-0-1 after food x 30 days", "Review after 1 month"].join("\n");
    const result = detectCandidates(text, catalog);
    expect(result.map((c) => c.field).sort()).toEqual(["brand_name", "food_instruction", "frequency"]);
    expect(byField(result, "brand_name")?.detectedText).toBe("Tab Glycomet 500mg");
    expect(byField(result, "frequency")?.detectedText).toBe("1-0-1 after food x 30 days");
    expect(byField(result, "food_instruction")?.detectedText).toBe("1-0-1 after food x 30 days");
  });

  it("produces no candidates for unrelated clinical text", () => {
    const text = ["Patient: Ramesh Kumar", "Age: 54 yrs", "Date: 12/08/2026", "Diagnosis: viral fever", "Advice: rest and fluids"].join("\n");
    expect(detectCandidates(text, catalog)).toEqual([]);
  });

  it("produces no candidates for empty or whitespace-only input", () => {
    expect(detectCandidates("", catalog)).toEqual([]);
    expect(detectCandidates("\n  \n\t\n", catalog)).toEqual([]);
  });

  it("does not propose dose quantity or duration — those are not detected here by design", () => {
    expect(detectCandidates("500 mg for 30 days", catalog)).toEqual([]);
  });
});
