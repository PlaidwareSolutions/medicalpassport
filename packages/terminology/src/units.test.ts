import { describe, expect, it } from "vitest";
import { ANALYTES_V1 } from "./analytes.v1.js";
import { OBSERVATION_CONCEPTS_V1 } from "./observation-concepts.v1.js";
import {
  UnitConversionError,
  convertUnit,
  listAllowedUnits,
  normalizeUnitText,
  resolveUnitCode,
  toCanonicalUnit,
} from "./units.js";

const ROUND_TRIP_TOL = 1e-9;
const SAMPLE_VALUES = [0, 0.001, 0.7, 1, 5.5, 42, 97.6, 250, 1000, 250000];

function expectClose(actual: number, expected: number, tol = ROUND_TRIP_TOL): void {
  const scale = Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected) / scale).toBeLessThanOrEqual(tol);
}

describe("round trips", () => {
  const entries = [...ANALYTES_V1, ...OBSERVATION_CONCEPTS_V1].filter((e) => e.canonicalUnit !== null);

  it("every entered unit round-trips through the canonical unit within 1e-9", () => {
    let checked = 0;
    for (const e of entries) {
      const canonical = e.canonicalUnit as string;
      for (const u of e.allowedEnteredUnits) {
        for (const v of SAMPLE_VALUES) {
          const c = convertUnit(v, u.unit, canonical, e.key);
          const back = convertUnit(c, canonical, u.unit, e.key);
          expectClose(back, v);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("every pair of allowed units round-trips (entered -> entered)", () => {
    for (const e of entries) {
      const units = listAllowedUnits(e.key).map((u) => u.unit);
      for (const a of units) {
        for (const b of units) {
          for (const v of SAMPLE_VALUES) {
            expectClose(convertUnit(convertUnit(v, a, b, e.key), b, a, e.key), v);
          }
        }
      }
    }
  });

  it("converting a unit to itself is the identity", () => {
    for (const e of entries) {
      for (const u of listAllowedUnits(e.key)) {
        expect(convertUnit(123.456, u.unit, u.unit, e.key)).toBe(123.456);
        expect(convertUnit(123.456, u.display, u.unit, e.key)).toBe(123.456);
      }
    }
  });
});

describe("well-known factors", () => {
  it("glucose mg/dL <-> mmol/L (18.0182)", () => {
    expectClose(convertUnit(5.5, "mmol/L", "mg/dL", "fasting_glucose"), 99.1001);
    expectClose(convertUnit(99.1001, "mg/dL", "mmol/L", "fasting_glucose"), 5.5);
    expectClose(convertUnit(7, "mmol/L", "mg/dL", "blood_glucose"), 126.1274);
    expectClose(convertUnit(7, "mmol/L", "mg/dL", "post_prandial_glucose"), 126.1274);
  });

  it("cholesterol mg/dL <-> mmol/L (38.67)", () => {
    expectClose(convertUnit(5, "mmol/L", "mg/dL", "total_cholesterol"), 193.35);
    expectClose(convertUnit(193.35, "mg/dL", "mmol/L", "ldl_cholesterol"), 5);
    expectClose(convertUnit(1, "mmol/L", "mg/dL", "hdl_cholesterol"), 38.67);
  });

  it("triglycerides mg/dL <-> mmol/L (88.57)", () => {
    expectClose(convertUnit(1.7, "mmol/L", "mg/dL", "triglycerides"), 150.569);
  });

  it("creatinine mg/dL <-> µmol/L (88.42)", () => {
    expectClose(convertUnit(1, "mg/dL", "µmol/L", "creatinine"), 88.42);
    expectClose(convertUnit(88.42, "umol/L", "mg/dL", "creatinine"), 1);
  });

  it("urea mg/dL <-> mmol/L (6.006) — urea to urea, never to BUN", () => {
    expectClose(convertUnit(5, "mmol/L", "mg/dL", "urea"), 30.03);
  });

  it("bilirubin and uric acid µmol/L", () => {
    expectClose(convertUnit(17.104, "µmol/L", "mg/dL", "bilirubin_total"), 1);
    expectClose(convertUnit(59.48, "µmol/L", "mg/dL", "uric_acid"), 1);
  });

  it("temperature °C <-> °F (affine)", () => {
    expectClose(convertUnit(98.6, "°F", "°C", "body_temperature"), 37);
    expectClose(convertUnit(37, "°C", "°F", "body_temperature"), 98.6);
    expectClose(convertUnit(32, "[degF]", "Cel", "body_temperature"), 0);
    expectClose(convertUnit(-40, "F", "C", "body_temperature"), -40);
  });

  it("HbA1c % <-> mmol/mol (NGSP/IFCC master equation, affine)", () => {
    expectClose(convertUnit(53, "mmol/mol", "%", "hba1c"), 7.00044);
    expectClose(convertUnit(7.00044, "%", "mmol/mol", "hba1c"), 53);
  });

  it("platelets lakhs/cumm and thousand/µL to absolute /µL", () => {
    expect(convertUnit(2.5, "lakhs/cumm", "/µL", "platelet_count")).toBe(250000);
    expect(convertUnit(250, "thousand/µL", "/cumm", "platelet_count")).toBe(250000);
    expect(convertUnit(250000, "/µL", "lakhs/cumm", "platelet_count")).toBe(2.5);
  });

  it("T3 ng/mL -> ng/dL (×100)", () => {
    expect(convertUnit(1.2, "ng/mL", "ng/dL", "t3_total")).toBe(120);
  });

  it("weight and height", () => {
    expectClose(convertUnit(154.3235835, "lb", "kg", "body_weight"), 70);
    expectClose(convertUnit(1.75, "m", "cm", "body_height"), 175);
    expectClose(convertUnit(70, "in", "cm", "body_height"), 177.8);
  });

  it("monovalent electrolytes mEq/L == mmol/L", () => {
    expect(convertUnit(140, "mmol/L", "mEq/L", "sodium")).toBe(140);
    expect(convertUnit(4.2, "mEq/L", "mmol/L", "potassium")).toBe(4.2);
  });

  it("TSH µIU/mL == mIU/L", () => {
    expect(convertUnit(2.5, "mIU/L", "µIU/mL", "tsh")).toBe(2.5);
  });
});

describe("unit spelling", () => {
  it("normalises micro sign, Greek mu, whitespace and case", () => {
    expect(normalizeUnitText("µmol/L")).toBe("umol/l");
    expect(normalizeUnitText("μmol / L")).toBe("umol/l");
    expect(normalizeUnitText("MG/DL")).toBe("mg/dl");
  });

  it("resolves display forms and aliases to the UCUM code", () => {
    expect(resolveUnitCode("creatinine", "µmol/L")).toBe("umol/L");
    expect(resolveUnitCode("creatinine", "mcmol/L")).toBe("umol/L");
    expect(resolveUnitCode("tsh", "µIU/mL")).toBe("u[IU]/mL");
    expect(resolveUnitCode("tsh", "uIU/mL")).toBe("u[IU]/mL");
    expect(resolveUnitCode("platelet_count", "lakh/cumm")).toBe("10*5/uL");
    expect(resolveUnitCode("body_temperature", "fahrenheit")).toBe("[degF]");
    expect(resolveUnitCode("esr", "mm/1st hr")).toBe("mm/h");
  });

  it("listAllowedUnits puts the canonical unit first", () => {
    const units = listAllowedUnits("fasting_glucose");
    expect(units[0]).toEqual({ unit: "mg/dL", display: "mg/dL", isCanonical: true });
    expect(units.map((u) => u.unit)).toEqual(["mg/dL", "mmol/L"]);
  });

  it("toCanonicalUnit returns the UCUM canonical code", () => {
    const r = toCanonicalUnit(5.5, "mmol/L", "fasting_glucose");
    expectClose(r.value, 99.1001);
    expect(r.unit).toBe("mg/dL");
  });
});

describe("refusals (typed errors, never silent)", () => {
  function codeOf(fn: () => unknown): string {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(UnitConversionError);
      return (err as UnitConversionError).code;
    }
    throw new Error("expected a UnitConversionError");
  }

  it("unknown key", () => {
    expect(codeOf(() => convertUnit(1, "mg/dL", "mmol/L", "not_a_key"))).toBe("unknown_key");
    expect(codeOf(() => listAllowedUnits("not_a_key"))).toBe("unknown_key");
    expect(codeOf(() => toCanonicalUnit(1, "mg/dL", "not_a_key"))).toBe("unknown_key");
  });

  it("open entries have no canonical unit", () => {
    expect(codeOf(() => convertUnit(1, "mg/dL", "mg/dL", "other"))).toBe("no_canonical_unit");
    expect(codeOf(() => toCanonicalUnit(1, "mg/dL", "other"))).toBe("no_canonical_unit");
    expect(listAllowedUnits("other")).toEqual([]);
  });

  it("never converts across incompatible dimensions", () => {
    // mass concentration -> mass
    expect(codeOf(() => convertUnit(1, "mg/dL", "kg", "fasting_glucose"))).toBe("unsupported_unit");
    // a unit that is valid for a different entry of the same dimension is still refused for this key
    expect(codeOf(() => convertUnit(1, "µmol/L", "mg/dL", "fasting_glucose"))).toBe("unsupported_unit");
    // temperature -> anything else
    expect(codeOf(() => convertUnit(37, "°C", "kg", "body_temperature"))).toBe("unsupported_unit");
    // canonical is fine but the target is not allowed
    expect(codeOf(() => convertUnit(98, "%", "mmHg", "spo2"))).toBe("unsupported_unit");
    // urea mg/dL is NOT converted to BUN by relabelling the unit
    expect(codeOf(() => convertUnit(30, "mg/dL", "mg/dL BUN", "urea"))).toBe("unsupported_unit");
  });

  it("carries key and unit on the error", () => {
    try {
      convertUnit(1, "cups", "mg/dL", "fasting_glucose");
      throw new Error("unreachable");
    } catch (err) {
      const e = err as UnitConversionError;
      expect(e.name).toBe("UnitConversionError");
      expect(e.key).toBe("fasting_glucose");
      expect(e.unit).toBe("cups");
      expect(e.message).toContain("mg/dL");
    }
  });

  it("rejects non-finite values", () => {
    expect(codeOf(() => convertUnit(Number.NaN, "mg/dL", "mmol/L", "fasting_glucose"))).toBe("non_finite_value");
    expect(codeOf(() => convertUnit(Number.POSITIVE_INFINITY, "mg/dL", "mmol/L", "fasting_glucose"))).toBe(
      "non_finite_value",
    );
  });
});
