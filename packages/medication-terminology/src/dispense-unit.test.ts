import { describe, expect, it } from "vitest";
import { dispensedQuantityForSupply, normalizeDispenseUnit, unitMismatchMessage } from "./dispense-unit.js";

describe("normalizeDispenseUnit", () => {
  it("reads the spellings a pharmacist actually types", () => {
    expect(normalizeDispenseUnit("Tablets")).toBe("tablet");
    expect(normalizeDispenseUnit(" tab. ")).toBe("tablet");
    expect(normalizeDispenseUnit("CAPS")).toBe("capsule");
    expect(normalizeDispenseUnit("mL")).toBe("ml");
    expect(normalizeDispenseUnit("IU")).toBe("unit");
  });

  it("refuses to read a pack as a dose unit — a strip is not a number of tablets", () => {
    for (const pack of ["strip", "strips", "bottle", "vial", "tube", "box", ""]) {
      expect(normalizeDispenseUnit(pack)).toBeNull();
    }
    expect(normalizeDispenseUnit(null)).toBeNull();
  });
});

describe("dispensedQuantityForSupply", () => {
  it("adds the quantity when the two units name the same thing", () => {
    expect(dispensedQuantityForSupply({ quantity: 30, dispenseUnit: "tablet", trackedUnit: "tablet" })).toEqual({
      ok: true,
      quantity: 30,
      trackedUnit: "tablet",
    });
    expect(dispensedQuantityForSupply({ quantity: 30, dispenseUnit: "Tabs", trackedUnit: "tablet" })).toEqual({
      ok: true,
      quantity: 30,
      trackedUnit: "tablet",
    });
  });

  it("refuses a dispense in a unit the patient does not count in", () => {
    const result = dispensedQuantityForSupply({ quantity: 30, dispenseUnit: "strip", trackedUnit: "tablet" });
    expect(result).toEqual({ ok: false, reason: "unit_mismatch", dispenseUnit: "strip", trackedUnit: "tablet" });
    // and never guesses a pack size in either direction
    expect(dispensedQuantityForSupply({ quantity: 2, dispenseUnit: "bottle", trackedUnit: "ml" }).ok).toBe(false);
    expect(dispensedQuantityForSupply({ quantity: 5, dispenseUnit: "ml", trackedUnit: "tablet" }).ok).toBe(false);
  });

  it("takes the quantity as given when the medicine has no confirmed instruction to contradict", () => {
    expect(dispensedQuantityForSupply({ quantity: 30, dispenseUnit: "strip", trackedUnit: null })).toEqual({
      ok: true,
      quantity: 30,
      trackedUnit: null,
    });
  });
});

describe("unitMismatchMessage", () => {
  it("names both units and what to do about it", () => {
    expect(unitMismatchMessage("strip", "tablet")).toBe(
      "The patient counts this medicine in tablet, not strip. Record the quantity in tablet so their supply stays right.",
    );
  });
});
