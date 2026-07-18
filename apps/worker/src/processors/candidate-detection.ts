import { parsePattern } from "@medpass/medication-terminology";
import type { FoodInstruction, FrequencyCode } from "@medpass/domain";

export interface DetectedCandidate {
  field: "brand_name" | "frequency" | "food_instruction";
  detectedText: string;
  proposedValue?: string;
  confidence: number;
}

interface CatalogProduct {
  id: string;
  brandName: string | null;
  brandAliases: string[];
  genericName: string;
}

const FREQUENCY_ABBREVIATIONS: Record<string, FrequencyCode> = {
  od: "OD",
  bd: "BD",
  tds: "TDS",
  tid: "TDS",
  qid: "QID",
  sos: "SOS",
  hs: "HS",
};

const FOOD_KEYWORDS: Array<{ regex: RegExp; value: FoodInstruction }> = [
  { regex: /before\s+food/i, value: "before" },
  { regex: /with\s+food/i, value: "with" },
  { regex: /after\s+food/i, value: "after" },
  { regex: /at\s+bed\s*time|bedtime/i, value: "bedtime" },
];

/**
 * Deterministic, rule-based candidate detection over raw OCR (or PDF-text)
 * output — no AI, no guessing. Every candidate keeps its source line
 * (`detectedText`) so the patient always sees exactly what was on the page
 * next to the proposal (docs/09 §6). Dose quantity/duration are
 * intentionally not detected here: OCR digits are unreliable for a
 * hazard-critical field, so those stay as typed pickers (docs/22 Stage 3/8
 * scoping).
 *
 * Only the single highest-confidence match per field is kept — one proposal
 * slot per field, mirroring the confirmation model in ExtractionCandidate.
 */
export function detectCandidates(rawText: string, catalog: CatalogProduct[]): DetectedCandidate[] {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const byField = new Map<string, DetectedCandidate>();
  const keep = (candidate: DetectedCandidate) => {
    const existing = byField.get(candidate.field);
    if (!existing || candidate.confidence > existing.confidence) {
      byField.set(candidate.field, candidate);
    }
  };

  for (const line of lines) {
    detectBrand(line, catalog, keep);
    detectFrequency(line, keep);
    detectFoodInstruction(line, keep);
  }

  return [...byField.values()];
}

function detectBrand(line: string, catalog: CatalogProduct[], keep: (c: DetectedCandidate) => void) {
  const lower = line.toLowerCase();
  for (const product of catalog) {
    const names = [product.brandName, ...product.brandAliases].filter((n): n is string => Boolean(n));
    for (const name of names) {
      if (name.length < 3) continue;
      if (lower.includes(name.toLowerCase())) {
        keep({ field: "brand_name", detectedText: line, proposedValue: product.id, confidence: 0.9 });
        return;
      }
    }
  }
}

function detectFrequency(line: string, keep: (c: DetectedCandidate) => void) {
  const patternMatch = line.match(/\b(\d(?:\.\d)?-\d(?:\.\d)?-\d(?:\.\d)?)\b/);
  const patternText = patternMatch?.[1];
  if (patternText) {
    const slots = parsePattern(patternText);
    if (slots) {
      keep({ field: "frequency", detectedText: line, proposedValue: `PATTERN:${patternText}`, confidence: 0.85 });
      return;
    }
  }
  const abbrevMatch = line.match(/\b(od|bd|tds|tid|qid|sos|hs)\b/i);
  const abbrevText = abbrevMatch?.[1];
  if (abbrevText) {
    const code = FREQUENCY_ABBREVIATIONS[abbrevText.toLowerCase()];
    if (code) keep({ field: "frequency", detectedText: line, proposedValue: code, confidence: 0.75 });
  }
}

function detectFoodInstruction(line: string, keep: (c: DetectedCandidate) => void) {
  for (const { regex, value } of FOOD_KEYWORDS) {
    if (regex.test(line)) {
      keep({ field: "food_instruction", detectedText: line, proposedValue: value, confidence: 0.75 });
      return;
    }
  }
}
