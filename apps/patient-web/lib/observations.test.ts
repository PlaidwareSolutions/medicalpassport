import { describe, expect, it } from "vitest";
import {
  axisTicks,
  bucketLabel,
  conceptDecimals,
  formatObservationValue,
  HUB_CONCEPTS,
  isHubConcept,
  isMorning,
  latestPerConcept,
  LEGACY_DIARY_ROUTES,
  magnitudeDecimals,
  observationValueText,
  roundForDisplay,
  trimDecimal,
  type ObservationDto,
} from "./observations";
import { analyteDecimals, formatAnalyteValue, groupReportsByKind, referenceRangeText, showsCanonicalTwin } from "./diagnostics";

function obs(partial: Partial<ObservationDto>): ObservationDto {
  return {
    id: "o1",
    concept: "body_weight",
    label: "Body weight",
    valueNumeric: "72.500",
    valueNumeric2: null,
    valueText: null,
    unit: "kg",
    enteredUnit: null,
    enteredValueText: null,
    context: null,
    bodySite: null,
    method: null,
    measuredAt: "2026-09-06T02:30:00.000Z",
    measuredAtLocal: "2026-09-06T08:00:00",
    interpretation: null,
    notes: null,
    deviceId: null,
    provenanceSource: "user_entered",
    verification: "patient_confirmed",
    createdAt: "2026-09-06T02:30:00.000Z",
    ...partial,
  };
}

describe("observation display (docs_v2/10 H-25: a number, never a verdict)", () => {
  it("renders BP as systolic/diastolic with the canonical unit", () => {
    expect(observationValueText(obs({ concept: "blood_pressure", valueNumeric: "120.000", valueNumeric2: "80.000", unit: "mmHg" }))).toBe("120/80 mmHg");
  });
  it("trims fixed-scale decimals", () => {
    expect(observationValueText(obs({ valueNumeric: "72.500" }))).toBe("72.5 kg");
    expect(observationValueText(obs({ concept: "blood_glucose", valueNumeric: "98.000", unit: "mg/dL" }))).toBe("98 mg/dL");
    expect(trimDecimal("36.500")).toBe("36.5");
    expect(trimDecimal(null)).toBe("");
  });
  it("shows pain as a score out of ten", () => {
    expect(observationValueText(obs({ concept: "pain_score", valueNumeric: "4.000", unit: "{score}" }))).toBe("4 / 10");
  });
  it("never appends any interpretation word", () => {
    const text = observationValueText(obs({ concept: "blood_glucose", valueNumeric: "260.000", unit: "mg/dL", interpretation: "high" }));
    expect(text).toBe("260 mg/dL");
    expect(text.toLowerCase()).not.toContain("high");
  });
});

describe("hub helpers", () => {
  it("keeps the newest reading per concept", () => {
    const latest = latestPerConcept([
      obs({ id: "a", measuredAt: "2026-09-01T00:00:00.000Z" }),
      obs({ id: "b", measuredAt: "2026-09-05T00:00:00.000Z" }),
      obs({ id: "c", concept: "spo2", unit: "%", valueNumeric: "97", measuredAt: "2026-09-02T00:00:00.000Z" }),
    ]);
    expect(latest.get("body_weight")?.id).toBe("b");
    expect(latest.get("spo2")?.id).toBe("c");
  });
  it("splits morning/evening on the patient's own clock", () => {
    expect(isMorning(obs({ measuredAtLocal: "2026-09-06T08:00:00" }))).toBe(true);
    expect(isMorning(obs({ measuredAtLocal: "2026-09-06T21:15:00" }))).toBe(false);
    expect(isMorning(obs({ measuredAtLocal: null }))).toBeNull();
  });
  it("maps every legacy diary route onto a hub concept", () => {
    for (const concept of Object.values(LEGACY_DIARY_ROUTES)) expect(isHubConcept(concept)).toBe(true);
    expect(HUB_CONCEPTS).toContain("blood_glucose");
    expect(isHubConcept("bmi")).toBe(false);
  });
  it("labels buckets without a timezone shift", () => {
    expect(bucketLabel("2026-09", "month", "en")).toMatch(/Sep.*2026/);
    expect(bucketLabel("2026-09-06", "day", "en")).toMatch(/6/);
  });
  it("labels a week as the range it covers, so it can't be read as a single day", () => {
    const week = bucketLabel("2026-09-06", "week", "en");
    expect(week).not.toBe(bucketLabel("2026-09-06", "day", "en"));
    expect(week).toMatch(/6.*12/); // 6th to the 12th
    // A week that straddles a month names both months, not just the second.
    expect(bucketLabel("2026-08-30", "week", "en")).toMatch(/Aug.*Sep/);
  });
});

/**
 * Item 1 of the production QA pass: a converted value was printed at the
 * precision of the conversion, not of the measurement — 7.8 mmol/L became
 * "140.542 mg/dL", a BP bucket average "127.143/89.286 mmHg", an HbA1c
 * "7.2749 %".
 */
describe("display precision (a converted number, at the precision it deserves)", () => {
  it("shows glucose and blood pressure as whole numbers", () => {
    expect(formatObservationValue(140.5416, "blood_glucose")).toBe("141");
    expect(observationValueText(obs({ concept: "blood_glucose", valueNumeric: "140.5416", unit: "mg/dL" }))).toBe("141 mg/dL");
    expect(observationValueText(obs({ concept: "blood_pressure", valueNumeric: "127.143", valueNumeric2: "89.286", unit: "mm[Hg]" }))).toBe("127/89 mmHg");
  });
  it("keeps one decimal for weight and temperature", () => {
    expect(observationValueText(obs({ concept: "body_weight", valueNumeric: "72.4999", unit: "kg" }))).toBe("72.5 kg");
    expect(formatObservationValue(36.6667, "body_temperature")).toBe("36.7");
  });
  it("never leaves a trailing zero behind", () => {
    expect(formatObservationValue(72.0, "body_weight")).toBe("72");
    expect(roundForDisplay("12.000", 1)).toBe("12");
  });
  it("falls back to magnitude when a concept has no rule, so a small value survives", () => {
    expect(magnitudeDecimals(0.94)).toBe(2);
    expect(magnitudeDecimals(42.5)).toBe(1);
    expect(magnitudeDecimals(180)).toBe(0);
    expect(conceptDecimals(undefined, 0.94)).toBe(2);
    expect(conceptDecimals("blood_glucose", 0.94)).toBe(0);
  });
  it("leaves non-numeric and empty values exactly as they are", () => {
    expect(formatObservationValue(null)).toBe("");
    expect(formatObservationValue("")).toBe("");
    expect(formatObservationValue("negative")).toBe("negative");
  });
  it("changes nothing about the stored value — trimDecimal is untouched", () => {
    expect(trimDecimal("140.5416")).toBe("140.542");
    expect(trimDecimal("7.2749")).toBe("7.275");
  });
});

describe("lab display precision (H-35: the entered value is never what gets rounded)", () => {
  it("prints HbA1c to one decimal, the way every lab reports it", () => {
    expect(formatAnalyteValue("7.2749", "hba1c")).toBe("7.3");
    expect(analyteDecimals("hba1c", 7.2749)).toBe(1);
  });
  it("prints sugars and cholesterol whole", () => {
    expect(formatAnalyteValue(140.5416, "fasting_glucose")).toBe("141");
    expect(formatAnalyteValue("193.6", "total_cholesterol")).toBe("194");
  });
  it("keeps the decimals a small result depends on", () => {
    expect(formatAnalyteValue("0.94", "creatinine")).toBe("0.94");
    expect(formatAnalyteValue("2.41", "tsh")).toBe("2.41");
  });
  it("falls back to magnitude for an analyte with no rule", () => {
    expect(formatAnalyteValue("0.876", "something_new")).toBe("0.88");
    expect(formatAnalyteValue("876.4", "something_new")).toBe("876");
  });
});

/**
 * Item 6: the axis used arithmetic midpoints, so two HbA1c values a month
 * apart rendered "Aug 26 / Aug 26 / Sept 26" — a tick naming an instant
 * nothing was measured at, colliding with a real one.
 */
describe("trend axis ticks", () => {
  const month = (x: number) => new Date(x).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
  const aug = Date.UTC(2026, 7, 12);
  const sep = Date.UTC(2026, 8, 14);

  it("never labels a point that was not measured", () => {
    const ticks = axisTicks([aug, sep, Date.UTC(2026, 9, 20)], month);
    expect(ticks.every((x) => [aug, sep, Date.UTC(2026, 9, 20)].includes(x))).toBe(true);
  });
  it("drops a tick whose label repeats one already on the axis", () => {
    // Three readings, two of them in the same month at this precision.
    const labels = axisTicks([aug, Date.UTC(2026, 7, 20), sep], month).map(month);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual([month(aug), month(sep)]);
  });
  it("keeps every point when there are no more than the maximum", () => {
    expect(axisTicks([aug, sep], month)).toEqual([aug, sep]);
    expect(axisTicks([aug], month)).toEqual([aug]);
    expect(axisTicks([], month)).toEqual([]);
  });
  it("returns points in time order and never duplicates one", () => {
    const ticks = axisTicks([sep, aug, aug], month);
    expect(ticks).toEqual([aug, sep]);
  });
});

describe("diagnostics helpers (H-35: entered value first, canonical alongside, never compared)", () => {
  it("shows the canonical twin only when the entered unit differs", () => {
    expect(showsCanonicalTwin({ unit: "mg/dL", enteredUnit: "mmol/L", valueNumeric: "180.18" })).toBe(true);
    expect(showsCanonicalTwin({ unit: "mg/dL", enteredUnit: "mg/dL", valueNumeric: "100" })).toBe(false);
    expect(showsCanonicalTwin({ unit: "mg/dL", enteredUnit: "mg / dl", valueNumeric: "100" })).toBe(false);
    expect(showsCanonicalTwin({ unit: "mg/dL", enteredUnit: null, valueNumeric: "100" })).toBe(false);
    expect(showsCanonicalTwin({ unit: "mg/dL", enteredUnit: "mmol/L", valueNumeric: null })).toBe(false);
  });
  it("renders the reference range as plain text from structured or printed values", () => {
    expect(referenceRangeText({ referenceLow: "13", referenceHigh: "17", referenceText: null })).toBe("13 – 17");
    expect(referenceRangeText({ referenceLow: null, referenceHigh: "5.7", referenceText: null })).toBe("≤ 5.7");
    expect(referenceRangeText({ referenceLow: null, referenceHigh: null, referenceText: "< 200" })).toBe("< 200");
    expect(referenceRangeText({ referenceLow: null, referenceHigh: null, referenceText: null })).toBeNull();
  });
  it("groups reports by kind in hub order and drops empty kinds", () => {
    const groups = groupReportsByKind([{ kind: "imaging" as const }, { kind: "laboratory" as const }, { kind: "laboratory" as const }]);
    expect(groups.map((g) => g.kind)).toEqual(["laboratory", "imaging"]);
    expect(groups[0]!.reports).toHaveLength(2);
  });
});

describe("unit display (UCUM code → printed form)", () => {
  it("prints the patient-facing unit for hub concepts and known codes", async () => {
    const { displayUnit } = await import("./observations");
    expect(displayUnit("blood_pressure", "mm[Hg]")).toBe("mmHg");
    expect(displayUnit("body_temperature", "Cel")).toBe("°C");
    expect(displayUnit("heart_rate", "/min")).toBe("bpm");
    expect(displayUnit("respiratory_rate", "/min")).toBe("/min");
    expect(displayUnit(undefined, "[degF]")).toBe("°F");
    expect(displayUnit("other", "widgets")).toBe("widgets");
    expect(observationValueText(obs({ concept: "blood_pressure", valueNumeric: "120", valueNumeric2: "80", unit: "mm[Hg]" }))).toBe("120/80 mmHg");
  });
});
