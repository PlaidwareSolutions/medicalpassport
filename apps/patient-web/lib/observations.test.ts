import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  HUB_CONCEPTS,
  isHubConcept,
  isMorning,
  latestPerConcept,
  LEGACY_DIARY_ROUTES,
  observationValueText,
  trimDecimal,
  type ObservationDto,
} from "./observations";
import { groupReportsByKind, referenceRangeText, showsCanonicalTwin } from "./diagnostics";

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
