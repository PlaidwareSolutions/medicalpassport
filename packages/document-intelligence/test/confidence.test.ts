import { describe, expect, it } from "vitest";
import { CONFIDENCE_THRESHOLDS, bucket, clamp01, combine } from "../src/index.js";

describe("CONFIDENCE_THRESHOLDS (docs_v2/09 §6 — change only with Gate 5 evidence)", () => {
  it("are 0.9 (pre-select) and 0.6 (please check)", () => {
    expect(CONFIDENCE_THRESHOLDS).toEqual({ preselect: 0.9, check: 0.6 });
  });
  it("are frozen", () => {
    expect(Object.isFrozen(CONFIDENCE_THRESHOLDS)).toBe(true);
  });
});

describe("bucket", () => {
  it.each([
    [1, "high"],
    [0.9, "high"],
    [0.8999, "medium"],
    [0.6, "medium"],
    [0.5999, "low"],
    [0, "low"],
    [Number.NaN, "low"],
  ])("bucket(%s) = %s", (c, b) => {
    expect(bucket(c)).toBe(b);
  });
});

describe("combine", () => {
  it("is the product of word confidence and match quality", () => {
    expect(combine(0.8, 0.9)).toBeCloseTo(0.72, 4);
    expect(combine(1, 0.85)).toBe(0.85);
  });
  it("clamps both inputs and the result to 0–1", () => {
    expect(combine(1.5, 2)).toBe(1);
    expect(combine(-1, 0.9)).toBe(0);
    expect(combine(Number.NaN, 0.9)).toBe(0);
  });
  it("clamp01 handles non-finite input", () => {
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
  });
});
