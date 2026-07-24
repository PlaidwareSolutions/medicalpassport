import { describe, expect, it } from "vitest";
import { defaultDoseUnitForForm } from "./dosage-form.js";

describe("defaultDoseUnitForForm", () => {
  it("maps known solid forms", () => {
    expect(defaultDoseUnitForForm("tablet")).toBe("tablet");
    expect(defaultDoseUnitForForm("capsule")).toBe("capsule");
  });

  it("maps liquid-like forms to ml", () => {
    expect(defaultDoseUnitForForm("syrup")).toBe("ml");
    expect(defaultDoseUnitForForm("suspension")).toBe("ml");
    expect(defaultDoseUnitForForm("solution")).toBe("ml");
  });

  it("maps drops, inhalers, sachets, and topicals", () => {
    expect(defaultDoseUnitForForm("drops")).toBe("drop");
    expect(defaultDoseUnitForForm("inhaler")).toBe("puff");
    expect(defaultDoseUnitForForm("sachet")).toBe("sachet");
    expect(defaultDoseUnitForForm("powder")).toBe("sachet");
    expect(defaultDoseUnitForForm("cream")).toBe("application");
    expect(defaultDoseUnitForForm("ointment")).toBe("application");
    expect(defaultDoseUnitForForm("gel")).toBe("application");
  });

  it("defaults injection to ml (insulin is the exception, patient can override)", () => {
    expect(defaultDoseUnitForForm("injection")).toBe("ml");
  });

  it("is case/whitespace-insensitive", () => {
    expect(defaultDoseUnitForForm("  Syrup ")).toBe("ml");
    expect(defaultDoseUnitForForm("INHALER")).toBe("puff");
  });

  it("never guesses for unrecognized or missing forms", () => {
    expect(defaultDoseUnitForForm("lozenge")).toBeUndefined();
    expect(defaultDoseUnitForForm(null)).toBeUndefined();
    expect(defaultDoseUnitForForm(undefined)).toBeUndefined();
    expect(defaultDoseUnitForForm("")).toBeUndefined();
  });
});
