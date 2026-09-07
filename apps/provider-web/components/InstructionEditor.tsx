"use client";
import { useEffect, useState } from "react";
import { ChoiceGrid, TextInput } from "@medpass/ui-web";
import {
  DOSE_UNITS,
  FOOD_INSTRUCTIONS,
  FOOD_LABELS,
  FREQUENCY_CODES,
  FREQUENCY_LABELS,
  type DoseUnit,
  type FoodInstruction,
  type FrequencyCode,
  type Instruction,
} from "../lib/transition";

const DOSE_CHOICES = ["0.5", "1", "2", "3"] as const;
const OTHER = "__other__";
const DURATION_CHOICES = ["ongoing", "5", "7", "10", "14", "30", "90", OTHER] as const;

const DOSE_UNIT_LABELS: Record<DoseUnit, string> = {
  tablet: "Tablet",
  capsule: "Capsule",
  ml: "ml (syrup)",
  drop: "Drop",
  puff: "Puff",
  sachet: "Sachet",
  unit: "Unit (injection)",
  application: "Application",
};

/**
 * Typing-free dose / frequency / food / duration pickers (docs/18 minimal
 * typing rule), the same vocabulary the patient app uses. Emits a complete
 * `Instruction` once dose, form and frequency are all chosen, `undefined`
 * before that — validation in lib/transition.ts decides what is required.
 */
export function InstructionEditor({
  value,
  onChange,
  namePrefix,
  showStrength = true,
}: {
  value: Instruction | undefined;
  onChange: (next: Instruction | undefined) => void;
  /** Distinguishes the radiogroups of several editors on one page for assistive tech. */
  namePrefix: string;
  showStrength?: boolean;
}) {
  const [doseChoice, setDoseChoice] = useState<string | undefined>(value ? (DOSE_CHOICES as readonly string[]).includes(String(value.doseQuantity)) ? String(value.doseQuantity) : OTHER : undefined);
  const [doseOther, setDoseOther] = useState(value && !(DOSE_CHOICES as readonly string[]).includes(String(value.doseQuantity)) ? String(value.doseQuantity) : "");
  const [doseUnit, setDoseUnit] = useState<DoseUnit | undefined>(value?.doseUnit);
  const [frequency, setFrequency] = useState<FrequencyCode | undefined>(value?.frequencyCode);
  const [pattern, setPattern] = useState(value?.pattern ?? "");
  const [food, setFood] = useState<FoodInstruction>(value?.foodInstruction ?? "any");
  const [durationChoice, setDurationChoice] = useState<string>(
    value?.durationDays === undefined ? "ongoing" : (DURATION_CHOICES as readonly string[]).includes(String(value.durationDays)) ? String(value.durationDays) : OTHER,
  );
  const [durationOther, setDurationOther] = useState(value?.durationDays !== undefined && !(DURATION_CHOICES as readonly string[]).includes(String(value.durationDays)) ? String(value.durationDays) : "");
  const [strength, setStrength] = useState(value?.strengthLabel ?? "");

  useEffect(() => {
    const doseQuantity = doseChoice === OTHER ? Number(doseOther) : doseChoice !== undefined ? Number(doseChoice) : NaN;
    if (!Number.isFinite(doseQuantity) || !doseUnit || !frequency) {
      onChange(undefined);
      return;
    }
    const durationDays = durationChoice === "ongoing" ? undefined : durationChoice === OTHER ? Number(durationOther) : Number(durationChoice);
    const next: Instruction = { doseQuantity, doseUnit, frequencyCode: frequency, foodInstruction: food };
    if (frequency === "PATTERN") next.pattern = pattern.trim();
    if (durationDays !== undefined && Number.isFinite(durationDays) && durationDays > 0) next.durationDays = durationDays;
    if (strength.trim()) next.strengthLabel = strength.trim();
    onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doseChoice, doseOther, doseUnit, frequency, pattern, food, durationChoice, durationOther, strength]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {showStrength ? (
        <TextInput label={`${namePrefix}: strength as written (optional)`} placeholder="e.g. 500 mg" value={strength} maxLength={60} onChange={(e) => setStrength(e.target.value)} />
      ) : null}
      <ChoiceGrid
        label={`${namePrefix}: how much each time`}
        columns={5}
        minItemWidth={72}
        choices={[...DOSE_CHOICES.map((d) => ({ value: d, label: d })), { value: OTHER, label: "Other" }]}
        value={doseChoice}
        onChange={setDoseChoice}
      />
      {doseChoice === OTHER ? (
        <TextInput label={`${namePrefix}: dose amount`} type="number" inputMode="decimal" min={0.1} max={100} step={0.5} value={doseOther} onChange={(e) => setDoseOther(e.target.value)} />
      ) : null}
      <ChoiceGrid
        label={`${namePrefix}: form`}
        columns={4}
        minItemWidth={150}
        choices={DOSE_UNITS.map((u) => ({ value: u, label: DOSE_UNIT_LABELS[u] }))}
        value={doseUnit}
        onChange={setDoseUnit}
      />
      <ChoiceGrid
        label={`${namePrefix}: how often`}
        columns={3}
        minItemWidth={170}
        choices={FREQUENCY_CODES.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }))}
        value={frequency}
        onChange={setFrequency}
      />
      {frequency === "PATTERN" ? (
        <TextInput
          label={`${namePrefix}: pattern (morning-afternoon-night)`}
          placeholder="1-0-1"
          inputMode="numeric"
          value={pattern}
          maxLength={11}
          onChange={(e) => setPattern(e.target.value)}
        />
      ) : null}
      <ChoiceGrid label={`${namePrefix}: with food`} columns={5} minItemWidth={130} choices={FOOD_INSTRUCTIONS.map((f) => ({ value: f, label: FOOD_LABELS[f] }))} value={food} onChange={setFood} />
      <ChoiceGrid
        label={`${namePrefix}: for how long`}
        columns={4}
        minItemWidth={110}
        choices={DURATION_CHOICES.map((d) => ({ value: d, label: d === "ongoing" ? "Ongoing" : d === OTHER ? "Other" : `${d} days` }))}
        value={durationChoice}
        onChange={setDurationChoice}
      />
      {durationChoice === OTHER ? (
        <TextInput label={`${namePrefix}: number of days`} type="number" inputMode="numeric" min={1} max={365} value={durationOther} onChange={(e) => setDurationOther(e.target.value)} />
      ) : null}
    </div>
  );
}
