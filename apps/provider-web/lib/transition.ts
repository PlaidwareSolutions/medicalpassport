/**
 * Medicine transition editor model — shared by the clinic reconciliation
 * (P11-4) and the hospital discharge transition (P14). Pure: the editor
 * screens hold `EditorLine[]` in state, this module validates it and turns
 * it into the API body (`ProposeReconciliation` / `ProposeDischarge`).
 *
 * Hazard H-34 (docs_v2/10): "stopped medicines proposed as current". Two
 * guards live here and are unit-tested:
 *   1. a STOP line never carries an instruction — `toPayloadLines` strips
 *      one even if the state somehow holds it, and `validateTransition`
 *      reports it;
 *   2. on a discharge transition every current medicine needs an explicit
 *      decision — nothing is silently carried over.
 */

export const DECISIONS = ["START", "CONTINUE", "CHANGE", "STOP"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Decisions an existing (current) medicine can take; START is for new medicines only. */
export const EXISTING_DECISIONS = ["CONTINUE", "CHANGE", "STOP"] as const satisfies readonly Decision[];

export const DOSE_UNITS = ["tablet", "capsule", "ml", "drop", "puff", "sachet", "unit", "application"] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];

export const FREQUENCY_CODES = ["OD", "OD_AFTERNOON", "BD", "TDS", "QID", "SOS", "HS", "PATTERN", "ALTERNATE_DAY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "CUSTOM"] as const;
export type FrequencyCode = (typeof FREQUENCY_CODES)[number];

export const FOOD_INSTRUCTIONS = ["before", "with", "after", "any", "bedtime"] as const;
export type FoodInstruction = (typeof FOOD_INSTRUCTIONS)[number];

const PATTERN_RE = /^\d(\.\d)?-\d(\.\d)?-\d(\.\d)?$/;

export interface Instruction {
  doseQuantity: number;
  doseUnit: DoseUnit;
  frequencyCode: FrequencyCode;
  pattern?: string;
  foodInstruction?: FoodInstruction;
  durationDays?: number;
  strengthLabel?: string | null;
  routeText?: string | null;
}

export interface CurrentMedicine {
  patientMedicationId: string;
  name: string;
  strengthLabel: string | null;
  instructionSummary: string;
}

export interface ExistingLine {
  kind: "existing";
  medicine: CurrentMedicine;
  decision?: Extract<Decision, "CONTINUE" | "CHANGE" | "STOP">;
  instruction?: Instruction;
  reasonText?: string;
}

export interface NewLine {
  kind: "new";
  /** Client-side key only; never sent. */
  id: string;
  name: string;
  instruction?: Instruction;
  reasonText?: string;
}

export type EditorLine = ExistingLine | NewLine;

export type TransitionMode = "reconciliation" | "discharge";

export interface TransitionIssue {
  /** `patientMedicationId` for an existing line, the client id for a new one, null for the whole proposal. */
  lineKey: string | null;
  message: string;
}

export function lineKey(line: EditorLine): string {
  return line.kind === "existing" ? line.medicine.patientMedicationId : line.id;
}

export function lineName(line: EditorLine): string {
  return line.kind === "existing" ? line.medicine.name : line.name;
}

export function validateInstruction(instruction: Instruction | undefined): string[] {
  const issues: string[] = [];
  if (!instruction) return ["Choose a dose, how often, and when to take it"];
  if (!(instruction.doseQuantity > 0) || instruction.doseQuantity > 100) issues.push("Dose must be more than 0 and at most 100");
  if (!DOSE_UNITS.includes(instruction.doseUnit)) issues.push("Choose the medicine form");
  if (!FREQUENCY_CODES.includes(instruction.frequencyCode)) issues.push("Choose how often");
  if (instruction.frequencyCode === "PATTERN" && !(instruction.pattern && PATTERN_RE.test(instruction.pattern))) {
    issues.push("A pattern looks like 1-0-1 (morning-afternoon-night)");
  }
  if (instruction.durationDays !== undefined && !(Number.isInteger(instruction.durationDays) && instruction.durationDays > 0 && instruction.durationDays <= 365)) {
    issues.push("Duration must be 1 to 365 days");
  }
  return issues;
}

/**
 * Everything that must hold before the review step. `mode: "discharge"`
 * adds H-34's "every current medicine needs an explicit decision".
 */
export function validateTransition(lines: readonly EditorLine[], mode: TransitionMode): TransitionIssue[] {
  const issues: TransitionIssue[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const key = lineKey(line);
    if (seen.has(key)) issues.push({ lineKey: key, message: `${lineName(line)} appears twice` });
    seen.add(key);

    if (line.kind === "existing") {
      if (!line.decision) {
        if (mode === "discharge") {
          issues.push({ lineKey: key, message: `${line.medicine.name}: decide continue, change or stop before discharge` });
        }
        continue;
      }
      if (line.decision === "CHANGE") {
        for (const m of validateInstruction(line.instruction)) issues.push({ lineKey: key, message: `${line.medicine.name}: ${m}` });
      }
      if (line.decision === "STOP" && line.instruction) {
        // H-34: a stopped medicine can never carry a "current" instruction.
        issues.push({ lineKey: key, message: `${line.medicine.name}: a stopped medicine cannot have a new dose` });
      }
      if (line.reasonText && line.reasonText.length > 500) issues.push({ lineKey: key, message: `${line.medicine.name}: reason is too long (500 characters)` });
    } else {
      const name = line.name.trim();
      if (name.length === 0) issues.push({ lineKey: key, message: "New medicine: type its name" });
      else if (name.length > 200) issues.push({ lineKey: key, message: `${name}: name is too long (200 characters)` });
      for (const m of validateInstruction(line.instruction)) issues.push({ lineKey: key, message: `${name || "New medicine"}: ${m}` });
    }
  }

  const decided = lines.filter((l) => l.kind === "new" || l.decision !== undefined);
  if (decided.length === 0) issues.push({ lineKey: null, message: "Nothing to send yet: decide on at least one medicine or add one" });
  if (decided.length > 50) issues.push({ lineKey: null, message: "At most 50 lines can be sent in one proposal" });
  return issues;
}

export interface PayloadInstruction {
  doseQuantity: number;
  doseUnit: DoseUnit;
  frequencyCode: FrequencyCode;
  pattern?: string;
  foodInstruction: FoodInstruction;
  durationDays?: number;
  strengthLabel?: string | null;
  routeText?: string | null;
}

export interface PayloadLine {
  decision: Decision;
  patientMedicationId?: string;
  proposedName?: string;
  proposedInstruction?: PayloadInstruction;
  reasonText?: string;
}

function toPayloadInstruction(i: Instruction): PayloadInstruction {
  const out: PayloadInstruction = {
    doseQuantity: i.doseQuantity,
    doseUnit: i.doseUnit,
    frequencyCode: i.frequencyCode,
    foodInstruction: i.foodInstruction ?? "any",
  };
  if (i.frequencyCode === "PATTERN" && i.pattern) out.pattern = i.pattern;
  if (i.durationDays !== undefined) out.durationDays = i.durationDays;
  if (i.strengthLabel) out.strengthLabel = i.strengthLabel;
  if (i.routeText) out.routeText = i.routeText;
  return out;
}

/**
 * The `lines` array of the API body. Undecided existing medicines are left
 * out (a clinic reconciliation may cover only what was discussed; the
 * discharge validator has already refused undecided ones). STOP lines are
 * emitted with the medicine id and reason only — never an instruction (H-34).
 */
export function toPayloadLines(lines: readonly EditorLine[]): PayloadLine[] {
  const out: PayloadLine[] = [];
  for (const line of lines) {
    if (line.kind === "new") {
      const payload: PayloadLine = { decision: "START", proposedName: line.name.trim() };
      if (line.instruction) payload.proposedInstruction = toPayloadInstruction(line.instruction);
      if (line.reasonText?.trim()) payload.reasonText = line.reasonText.trim();
      out.push(payload);
      continue;
    }
    if (!line.decision) continue;
    const payload: PayloadLine = { decision: line.decision, patientMedicationId: line.medicine.patientMedicationId };
    if (line.decision === "CHANGE" && line.instruction) payload.proposedInstruction = toPayloadInstruction(line.instruction);
    if (line.reasonText?.trim()) payload.reasonText = line.reasonText.trim();
    out.push(payload);
  }
  return out;
}

/** True when nothing in `lines` would become current after acceptance — every STOP line is inert (H-34). */
export function stopLinesCarryNoInstruction(lines: readonly PayloadLine[]): boolean {
  return lines.every((l) => l.decision !== "STOP" || l.proposedInstruction === undefined);
}

/** Review-step grouping: what the patient will keep taking vs. what stops, visibly apart. */
export function splitForReview(lines: readonly EditorLine[]): { active: EditorLine[]; stopped: EditorLine[]; undecided: EditorLine[] } {
  const active: EditorLine[] = [];
  const stopped: EditorLine[] = [];
  const undecided: EditorLine[] = [];
  for (const line of lines) {
    if (line.kind === "new") active.push(line);
    else if (line.decision === "STOP") stopped.push(line);
    else if (line.decision) active.push(line);
    else undecided.push(line);
  }
  return { active, stopped, undecided };
}

export const FREQUENCY_LABELS: Readonly<Record<FrequencyCode, string>> = {
  OD: "Once a day (morning)",
  OD_AFTERNOON: "Once a day (afternoon)",
  BD: "Twice a day",
  TDS: "Three times a day",
  QID: "Four times a day",
  SOS: "When needed",
  HS: "At bedtime",
  PATTERN: "Pattern (1-0-1)",
  ALTERNATE_DAY: "Alternate days",
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Every two weeks",
  MONTHLY: "Monthly",
  CUSTOM: "Custom",
};

export const FOOD_LABELS: Readonly<Record<FoodInstruction, string>> = {
  before: "Before food",
  with: "With food",
  after: "After food",
  any: "Any time",
  bedtime: "At bedtime",
};

export function instructionSummary(i: Instruction | undefined): string {
  if (!i) return "";
  const freq = i.frequencyCode === "PATTERN" && i.pattern ? i.pattern : FREQUENCY_LABELS[i.frequencyCode];
  const parts = [`${i.doseQuantity} ${i.doseUnit}`, freq, FOOD_LABELS[i.foodInstruction ?? "any"]];
  if (i.durationDays) parts.push(`${i.durationDays} days`);
  return parts.join(" · ");
}
