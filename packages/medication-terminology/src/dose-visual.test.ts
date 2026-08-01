import { describe, expect, it } from "vitest";
import {
  formatDoseAmount,
  hasFixedDailySlots,
  isCountableUnit,
  needsDoseUnitConfirmation,
  perSlotDoses,
  planDoseGlyphs,
  slotsAreUniform,
} from "./dose-visual.js";
import { proposeSlots } from "./frequency.js";

describe("planDoseGlyphs", () => {
  it("repeats a glyph per tablet", () => {
    expect(planDoseGlyphs(1, "tablet")).toEqual({ kind: "repeat", full: 1, half: false });
    expect(planDoseGlyphs(2, "tablet")).toEqual({ kind: "repeat", full: 2, half: false });
    expect(planDoseGlyphs(3, "capsule")).toEqual({ kind: "repeat", full: 3, half: false });
  });

  it("draws a half glyph for a half dose", () => {
    expect(planDoseGlyphs(0.5, "tablet")).toEqual({ kind: "repeat", full: 0, half: true });
    expect(planDoseGlyphs(1.5, "tablet")).toEqual({ kind: "repeat", full: 1, half: true });
  });

  it("never repeats a measured unit — there is no such thing as five syrups", () => {
    expect(planDoseGlyphs(5, "ml")).toEqual({ kind: "single", quantity: 5 });
    expect(planDoseGlyphs(10, "unit")).toEqual({ kind: "single", quantity: 10 });
    expect(planDoseGlyphs(1, "application")).toEqual({ kind: "single", quantity: 1 });
    expect(planDoseGlyphs(2, "puff")).toEqual({ kind: "single", quantity: 2 });
  });

  it("falls back to a numeral past the cap rather than drawing a wall of pills", () => {
    expect(planDoseGlyphs(4, "tablet")).toEqual({ kind: "single", quantity: 4 });
    expect(planDoseGlyphs(12, "tablet")).toEqual({ kind: "single", quantity: 12 });
  });

  it("falls back rather than rounding a fraction it cannot draw", () => {
    // A quarter tablet is a real prescription; rounding it to ½ would be a
    // wrong dose, so the numeral is shown instead.
    expect(planDoseGlyphs(0.25, "tablet")).toEqual({ kind: "single", quantity: 0.25 });
    expect(planDoseGlyphs(1.75, "tablet")).toEqual({ kind: "single", quantity: 1.75 });
  });

  it("does not crash on absent or nonsense quantities", () => {
    expect(planDoseGlyphs(0, "tablet")).toEqual({ kind: "single", quantity: 0 });
    expect(planDoseGlyphs(Number.NaN, "tablet").kind).toBe("single");
  });
});

describe("isCountableUnit", () => {
  it("matches the add-screen split exactly", () => {
    expect(isCountableUnit("tablet")).toBe(true);
    expect(isCountableUnit("capsule")).toBe(true);
    for (const u of ["ml", "drop", "puff", "sachet", "unit", "application"]) {
      expect(isCountableUnit(u)).toBe(false);
    }
  });
});

describe("perSlotDoses", () => {
  it("multiplies the dose by each slot's multiplier — BD of 2 is 2 morning and 2 at night", () => {
    const slots = proposeSlots("BD")!;
    expect(perSlotDoses(2, slots)).toEqual([
      { slot: "morning", amount: 2 },
      { slot: "night", amount: 2 },
    ]);
  });

  it("carries an uneven pattern through as different per-slot amounts", () => {
    const slots = proposeSlots("PATTERN", "2-0-1")!;
    expect(perSlotDoses(1, slots)).toEqual([
      { slot: "morning", amount: 2 },
      { slot: "night", amount: 1 },
    ]);
  });

  it("handles a half dose split across slots", () => {
    const slots = proposeSlots("PATTERN", "0.5-0-0.5")!;
    expect(perSlotDoses(1, slots)).toEqual([
      { slot: "morning", amount: 0.5 },
      { slot: "night", amount: 0.5 },
    ]);
  });
});

describe("slotsAreUniform", () => {
  it("is true for every frequency the patient UI can actually create", () => {
    for (const [code, pattern] of [
      ["OD", undefined],
      ["BD", undefined],
      ["TDS", undefined],
      ["HS", undefined],
      ["PATTERN", "1-0-1"],
      ["PATTERN", "1-1-1"],
      ["PATTERN", "0-0-1"],
    ] as const) {
      const slots = proposeSlots(code, pattern)!;
      expect(slotsAreUniform(perSlotDoses(1, slots))).toBe(true);
    }
  });

  it("is false for an uneven pattern, so the caller shows amounts per slot instead of one wrong number", () => {
    expect(slotsAreUniform(perSlotDoses(1, proposeSlots("PATTERN", "2-0-1")!))).toBe(false);
  });

  it("treats no slots as uniform", () => {
    expect(slotsAreUniform([])).toBe(true);
  });
});

describe("formatDoseAmount", () => {
  it("uses a real fraction character for halves", () => {
    expect(formatDoseAmount(0.5)).toBe("½");
    expect(formatDoseAmount(1.5)).toBe("1½");
    expect(formatDoseAmount(2.5)).toBe("2½");
  });

  it("leaves whole numbers and other fractions alone", () => {
    expect(formatDoseAmount(1)).toBe("1");
    expect(formatDoseAmount(10)).toBe("10");
    expect(formatDoseAmount(0.25)).toBe("0.25");
  });
});

describe("ambiguous frequencies", () => {
  it("still return null from proposeSlots, so the time-of-day row is omitted rather than guessed", () => {
    for (const code of ["SOS", "QID", "ALTERNATE_DAY", "CUSTOM"] as const) {
      expect(proposeSlots(code)).toBeNull();
    }
  });
});

describe("needsDoseUnitConfirmation", () => {
  it("asks about medicines the patient is still on", () => {
    expect(needsDoseUnitConfirmation("current", false)).toBe(true);
    // Paused is meant to resume, so its type still matters.
    expect(needsDoseUnitConfirmation("paused", false)).toBe(true);
  });

  it("never asks about a medicine already confirmed", () => {
    for (const status of ["current", "paused", "stopped", "completed"]) {
      expect(needsDoseUnitConfirmation(status, true)).toBe(false);
    }
  });

  it("never asks about history the patient has finished with", () => {
    // The regression this guards: including stopped/completed left the prompt
    // permanently unclearable for a pilot patient whose only remaining
    // unconfirmed medicines were ones they'd already stopped — and their
    // glyphs only ever appear on the "previous" tab anyway.
    for (const status of ["stopped", "completed", "unknown"]) {
      expect(needsDoseUnitConfirmation(status, false)).toBe(false);
    }
  });
});

describe("hasFixedDailySlots", () => {
  it("allows the frequencies that genuinely repeat every day", () => {
    for (const code of ["OD", "OD_AFTERNOON", "BD", "TDS", "HS", "PATTERN"]) {
      expect(hasFixedDailySlots(code)).toBe(true);
    }
  });

  it("refuses WEEKLY/FORTNIGHTLY/MONTHLY even though proposeSlots offers them a morning slot", () => {
    // The regression this guards: proposeSlots returns [{morning,1}] for all
    // three, but only as a time of day — the *days* come from the start date,
    // which a list tile doesn't have. Drawing a sun here would tell a patient
    // their monthly injection is a daily morning dose.
    for (const code of ["WEEKLY", "FORTNIGHTLY", "MONTHLY"] as const) {
      expect(proposeSlots(code)).not.toBeNull();
      expect(hasFixedDailySlots(code)).toBe(false);
    }
  });

  it("refuses the codes that are ambiguous for their own reasons", () => {
    for (const code of ["SOS", "QID", "ALTERNATE_DAY", "CUSTOM"]) {
      expect(hasFixedDailySlots(code)).toBe(false);
    }
  });
});
