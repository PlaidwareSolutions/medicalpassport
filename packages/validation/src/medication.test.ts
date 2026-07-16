import { describe, expect, it } from "vitest";
import { phoneSchema } from "./auth.js";
import { createMedicationSchema, instructionSchema } from "./medication.js";

describe("phoneSchema", () => {
  it("normalizes spaces and dashes", () => {
    expect(phoneSchema.parse("+91 90000 00001")).toBe("+919000000001");
  });
  it("rejects numbers without a country code", () => {
    expect(phoneSchema.safeParse("9000000001").success).toBe(false);
  });
});

describe("instructionSchema", () => {
  it("requires a pattern for PATTERN frequency", () => {
    const r = instructionSchema.safeParse({ doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN" });
    expect(r.success).toBe(false);
  });

  it("rejects SOS combined with a fixed pattern (never silently interpret)", () => {
    const r = instructionSchema.safeParse({
      doseQuantity: 1,
      doseUnit: "tablet",
      frequencyCode: "SOS",
      pattern: "1-0-1",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a typed 1-0-1 instruction", () => {
    const r = instructionSchema.safeParse({
      doseQuantity: 1,
      doseUnit: "tablet",
      frequencyCode: "PATTERN",
      pattern: "1-0-1",
      foodInstruction: "after",
    });
    expect(r.success).toBe(true);
  });
});

describe("createMedicationSchema", () => {
  const instruction = { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" };

  it("requires a product or an entered name", () => {
    expect(createMedicationSchema.safeParse({ source: "manual", instruction }).success).toBe(false);
    expect(
      createMedicationSchema.safeParse({ source: "manual", enteredName: "Dolo 650", instruction }).success,
    ).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    const r = createMedicationSchema.safeParse({
      source: "manual",
      enteredName: "Dolo 650",
      startDate: "2026-07-10",
      endDate: "2026-07-01",
      instruction,
    });
    expect(r.success).toBe(false);
  });
});
