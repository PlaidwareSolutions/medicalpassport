import { describe, expect, it } from "vitest";
import {
  EXTRACTION_TARGETS,
  NEVER_AUTO_PROPOSED,
  NeverAutoProposedError,
  TARGET_ENTITIES,
  UnknownExtractionTargetError,
  assertProposable,
  isProposable,
  isoDateSchema,
  listExtractionTargets,
  parseQuantityWithUnit,
  validateCandidateDraft,
  type ExtractionCandidateDraft,
} from "../src/index.js";

const base: ExtractionCandidateDraft = {
  targetEntity: "prescription",
  targetField: "prescribedAt",
  pageNumber: 1,
  detectedText: "Date: 12/08/2026",
  proposedValue: "2026-08-12",
  confidence: 0.9,
  extractor: { name: "test", version: "0" },
};

describe("target catalogue", () => {
  it("covers exactly the entities of docs_v2/09 §5", () => {
    expect([...TARGET_ENTITIES].sort()).toEqual(
      ["allergy", "condition", "diagnostic_report", "diagnostic_result", "encounter", "immunization", "medication", "organization", "practitioner", "prescription"].sort(),
    );
  });

  it("lists the §5 fields per entity", () => {
    expect(Object.keys(EXTRACTION_TARGETS.prescription)).toEqual(["prescribedAt", "diagnosisText", "validUntil", "followUpOn"]);
    expect(Object.keys(EXTRACTION_TARGETS.medication)).toEqual([
      "brandName", "genericName", "strengthLabel", "form", "route", "frequency", "foodInstruction", "durationDays", "instructionsText", "doseQuantity",
    ]);
    expect(Object.keys(EXTRACTION_TARGETS.diagnostic_result)).toEqual([
      "analyteLabelText", "analyteKey", "enteredValueText", "enteredUnit", "referenceText", "comparator", "interpretation",
    ]);
    expect(Object.keys(EXTRACTION_TARGETS.immunization)).toEqual(["vaccineText", "administeredOn", "doseNumber"]);
  });

  it("every target except the never-auto-proposed ones is proposable", () => {
    for (const { entity, field } of listExtractionTargets()) {
      const banned = (NEVER_AUTO_PROPOSED[entity] ?? []).includes(field);
      expect(isProposable(entity, field), `${entity}.${field}`).toBe(!banned);
    }
  });
});

describe("never auto-proposed guard", () => {
  it("is exactly dose quantity and lab interpretation", () => {
    expect(NEVER_AUTO_PROPOSED).toEqual({ medication: ["doseQuantity"], diagnostic_result: ["interpretation"] });
  });

  it("assertProposable throws NeverAutoProposedError for both", () => {
    expect(() => assertProposable("medication", "doseQuantity")).toThrow(NeverAutoProposedError);
    expect(() => assertProposable("diagnostic_result", "interpretation")).toThrow(NeverAutoProposedError);
  });

  it("assertProposable throws for unknown targets", () => {
    expect(() => assertProposable("medication", "colour")).toThrow(UnknownExtractionTargetError);
    expect(() => assertProposable("spaceship", "name")).toThrow(UnknownExtractionTargetError);
  });

  it("assertProposable passes for ordinary targets", () => {
    expect(() => assertProposable("medication", "frequency")).not.toThrow();
    expect(() => assertProposable("diagnostic_result", "enteredUnit")).not.toThrow();
  });

  it("the constant is frozen", () => {
    expect(Object.isFrozen(NEVER_AUTO_PROPOSED)).toBe(true);
    expect(Object.isFrozen(NEVER_AUTO_PROPOSED.medication)).toBe(true);
  });
});

describe("validateCandidateDraft", () => {
  it("accepts a well-formed draft", () => {
    const v = validateCandidateDraft(base);
    expect(v.ok).toBe(true);
  });

  it("rejects never-auto-proposed fields with a reason", () => {
    const v = validateCandidateDraft({ ...base, targetEntity: "medication", targetField: "doseQuantity", proposedValue: 1 });
    expect(v).toEqual({ ok: false, reasons: ["never_auto_proposed:medication.doseQuantity"] });
  });

  it("rejects unknown entity and field", () => {
    expect(validateCandidateDraft({ ...base, targetEntity: "nope" })).toEqual({ ok: false, reasons: ["unknown_entity:nope"] });
    expect(validateCandidateDraft({ ...base, targetField: "nope" })).toEqual({ ok: false, reasons: ["unknown_field:prescription.nope"] });
  });

  it("rejects a non-ISO or impossible date", () => {
    expect(validateCandidateDraft({ ...base, proposedValue: "12/08/2026" }).ok).toBe(false);
    expect(validateCandidateDraft({ ...base, proposedValue: "2026-02-30" }).ok).toBe(false);
    expect(isoDateSchema.safeParse("2024-02-29").success).toBe(true);
  });

  it("rejects a strength that is not {value, unit}", () => {
    const v = validateCandidateDraft({ ...base, targetEntity: "medication", targetField: "strengthLabel", proposedValue: "500 mg" });
    expect(v.ok).toBe(false);
    const ok = validateCandidateDraft({ ...base, targetEntity: "medication", targetField: "strengthLabel", proposedValue: { value: "500", unit: "mg" } });
    expect(ok.ok).toBe(true);
  });

  it("rejects a PATTERN frequency without a pattern and a non-PATTERN with one", () => {
    const f = (proposedValue: unknown) => validateCandidateDraft({ ...base, targetEntity: "medication", targetField: "frequency", proposedValue });
    expect(f({ code: "PATTERN" }).ok).toBe(false);
    expect(f({ code: "OD", pattern: "1-0-1" }).ok).toBe(false);
    expect(f({ code: "PATTERN", pattern: "1-0-1" }).ok).toBe(true);
    expect(f({ code: "WEEKLY" }).ok).toBe(false); // needs patient setup, not proposable
  });

  it("rejects bad structure: confidence out of range, box off the page, empty detectedText", () => {
    expect(validateCandidateDraft({ ...base, confidence: 1.2 }).ok).toBe(false);
    expect(validateCandidateDraft({ ...base, boundingBox: { x: 0.9, y: 0, w: 0.5, h: 0.1 } }).ok).toBe(false);
    expect(validateCandidateDraft({ ...base, detectedText: "   " }).ok).toBe(false);
    expect(validateCandidateDraft({ ...base, pageNumber: 0 }).ok).toBe(false);
    expect(validateCandidateDraft(null).ok).toBe(false);
    expect(validateCandidateDraft("x").ok).toBe(false);
  });

  it("returns the normalized value on success (trimmed text)", () => {
    const v = validateCandidateDraft({ ...base, targetEntity: "condition", targetField: "label", proposedValue: "  Type 2 diabetes  " });
    expect(v.ok && v.draft.proposedValue).toBe("Type 2 diabetes");
  });
});

describe("parseQuantityWithUnit", () => {
  it.each([
    ["500 mg", { value: "500", unit: "mg" }],
    ["2.5mg", { value: "2.5", unit: "mg" }],
    ["10 ml", { value: "10", unit: "ml" }],
    ["100 µg", { value: "100", unit: "mcg" }],
    ["5000 IU", { value: "5000", unit: "IU" }],
  ])("parses %s", (text, expected) => {
    expect(parseQuantityWithUnit(text)).toEqual(expected);
  });

  it("returns null for anything else", () => {
    expect(parseQuantityWithUnit("mg")).toBeNull();
    expect(parseQuantityWithUnit("five mg")).toBeNull();
    expect(parseQuantityWithUnit("")).toBeNull();
  });
});
