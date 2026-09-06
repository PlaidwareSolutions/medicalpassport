import { describe, expect, it } from "vitest";
import {
  instructionSummary,
  splitForReview,
  stopLinesCarryNoInstruction,
  toPayloadLines,
  validateInstruction,
  validateTransition,
  type EditorLine,
  type ExistingLine,
  type Instruction,
  type NewLine,
} from "./transition";

const metformin: ExistingLine = {
  kind: "existing",
  medicine: { patientMedicationId: "11111111-1111-4111-8111-111111111111", name: "Metformin 500", strengthLabel: "500 mg", instructionSummary: "1 tablet · BD · after" },
};
const atorvastatin: ExistingLine = {
  kind: "existing",
  medicine: { patientMedicationId: "22222222-2222-4222-8222-222222222222", name: "Atorvastatin 10", strengthLabel: "10 mg", instructionSummary: "1 tablet · HS · any" },
};
const od: Instruction = { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", foodInstruction: "after" };
const amlodipine: NewLine = { kind: "new", id: "new-1", name: "Amlodipine 5", instruction: od };

describe("validateTransition", () => {
  it("accepts one STOP and one START — the clinic e2e scenario", () => {
    const lines: EditorLine[] = [{ ...atorvastatin, decision: "STOP", reasonText: "LDL at target" }, amlodipine];
    expect(validateTransition(lines, "reconciliation")).toEqual([]);
  });

  it("refuses an empty proposal", () => {
    expect(validateTransition([], "reconciliation")).toEqual([{ lineKey: null, message: "Nothing to send yet: decide on at least one medicine or add one" }]);
    // Undecided existing lines alone are nothing to send either.
    expect(validateTransition([metformin], "reconciliation").map((i) => i.lineKey)).toEqual([null]);
  });

  it("a clinic reconciliation may leave a medicine undecided; a discharge may not (H-34)", () => {
    const lines: EditorLine[] = [metformin, { ...atorvastatin, decision: "CONTINUE" }];
    expect(validateTransition(lines, "reconciliation")).toEqual([]);
    expect(validateTransition(lines, "discharge")).toEqual([
      { lineKey: metformin.medicine.patientMedicationId, message: "Metformin 500: decide continue, change or stop before discharge" },
    ]);
  });

  it("a STOP line with an instruction is an error (H-34: STOP never becomes current)", () => {
    const issues = validateTransition([{ ...atorvastatin, decision: "STOP", instruction: od }], "reconciliation");
    expect(issues).toEqual([{ lineKey: atorvastatin.medicine.patientMedicationId, message: "Atorvastatin 10: a stopped medicine cannot have a new dose" }]);
  });

  it("CHANGE needs a complete instruction", () => {
    const issues = validateTransition([{ ...metformin, decision: "CHANGE" }], "reconciliation");
    expect(issues).toEqual([{ lineKey: metformin.medicine.patientMedicationId, message: "Metformin 500: Choose a dose, how often, and when to take it" }]);
    expect(validateTransition([{ ...metformin, decision: "CHANGE", instruction: { ...od, doseQuantity: 2 } }], "reconciliation")).toEqual([]);
  });

  it("a new medicine needs a name and an instruction; a pattern must look like 1-0-1", () => {
    expect(validateTransition([{ kind: "new", id: "n", name: "  ", instruction: od }], "reconciliation")).toEqual([{ lineKey: "n", message: "New medicine: type its name" }]);
    expect(validateTransition([{ kind: "new", id: "n", name: "Amlodipine 5" }], "reconciliation")).toEqual([
      { lineKey: "n", message: "Amlodipine 5: Choose a dose, how often, and when to take it" },
    ]);
    const badPattern: Instruction = { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-1" };
    expect(validateTransition([{ kind: "new", id: "n", name: "X", instruction: badPattern }], "reconciliation")[0]?.message).toContain("1-0-1");
    expect(validateTransition([{ kind: "new", id: "n", name: "X", instruction: { ...badPattern, pattern: "1-0-1" } }], "reconciliation")).toEqual([]);
  });

  it("the same medicine cannot appear twice", () => {
    const issues = validateTransition([{ ...metformin, decision: "CONTINUE" }, { ...metformin, decision: "STOP" }], "reconciliation");
    expect(issues.map((i) => i.message)).toContain("Metformin 500 appears twice");
  });

  it("bounds: dose, duration, line count", () => {
    expect(validateInstruction({ ...od, doseQuantity: 0 })).toEqual(["Dose must be more than 0 and at most 100"]);
    expect(validateInstruction({ ...od, durationDays: 400 })).toEqual(["Duration must be 1 to 365 days"]);
    const many: EditorLine[] = Array.from({ length: 51 }, (_, i) => ({ kind: "new", id: `n${i}`, name: `Med ${i}`, instruction: od }));
    expect(validateTransition(many, "reconciliation").map((i) => i.message)).toContain("At most 50 lines can be sent in one proposal");
  });
});

describe("toPayloadLines", () => {
  it("emits the API body: STOP with id + reason only, START with name + instruction", () => {
    const lines: EditorLine[] = [metformin, { ...atorvastatin, decision: "STOP", reasonText: " LDL at target " }, amlodipine];
    expect(toPayloadLines(lines)).toEqual([
      { decision: "STOP", patientMedicationId: atorvastatin.medicine.patientMedicationId, reasonText: "LDL at target" },
      {
        decision: "START",
        proposedName: "Amlodipine 5",
        proposedInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", foodInstruction: "after" },
      },
    ]);
  });

  it("strips an instruction from a STOP line even if the state holds one (H-34)", () => {
    const payload = toPayloadLines([{ ...atorvastatin, decision: "STOP", instruction: od }]);
    expect(payload).toEqual([{ decision: "STOP", patientMedicationId: atorvastatin.medicine.patientMedicationId }]);
    expect(stopLinesCarryNoInstruction(payload)).toBe(true);
    expect(stopLinesCarryNoInstruction([{ decision: "STOP", proposedInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", foodInstruction: "any" } }])).toBe(false);
  });

  it("CONTINUE carries no instruction; CHANGE carries the new one with defaults filled", () => {
    const payload = toPayloadLines([
      { ...metformin, decision: "CONTINUE" },
      { ...atorvastatin, decision: "CHANGE", instruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-0-1", durationDays: 30 } },
    ]);
    expect(payload).toEqual([
      { decision: "CONTINUE", patientMedicationId: metformin.medicine.patientMedicationId },
      {
        decision: "CHANGE",
        patientMedicationId: atorvastatin.medicine.patientMedicationId,
        proposedInstruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-0-1", foodInstruction: "any", durationDays: 30 },
      },
    ]);
  });
});

describe("review helpers", () => {
  it("separates stopped medicines from what stays active", () => {
    const { active, stopped, undecided } = splitForReview([metformin, { ...atorvastatin, decision: "STOP" }, amlodipine]);
    expect(active.map((l) => (l.kind === "new" ? l.name : l.medicine.name))).toEqual(["Amlodipine 5"]);
    expect(stopped.map((l) => (l.kind === "existing" ? l.medicine.name : ""))).toEqual(["Atorvastatin 10"]);
    expect(undecided).toHaveLength(1);
  });

  it("summarises an instruction the way the patient app does", () => {
    expect(instructionSummary(od)).toBe("1 tablet · Once a day (morning) · After food");
    expect(instructionSummary({ doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-0-1", durationDays: 5 })).toBe("1 tablet · 1-0-1 · Any time · 5 days");
    expect(instructionSummary(undefined)).toBe("");
  });
});
