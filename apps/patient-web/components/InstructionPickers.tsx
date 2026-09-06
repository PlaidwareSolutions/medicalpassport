"use client";
import { DOSE_UNITS, type DoseUnit, type FoodInstruction, type FrequencyCode } from "@medpass/domain";
import { ChoiceGrid, TextInput } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";

/**
 * The typing-free dose / frequency / food pickers shared by "Start this
 * medicine" and the prescription line editor (docs/18 minimal-typing rule,
 * docs_v2/06 P2-5). Never free text for a hazard-critical field (H-02).
 *
 * `optional` adds a "Not written on the prescription" choice to each
 * picker: a line transcribed off paper may honestly have no dose, and the
 * server is the one that decides whether a line can be started (400 with
 * per-field errors), so the editor must be able to say "unknown". Errors
 * from that answer render under the field they name.
 */
export interface InstructionDraft {
  doseUnit?: DoseUnit;
  /** String so the grid's "½" / "1" / "2" and a typed "7.5" share one shape. */
  doseQuantity?: string;
  frequencyCode?: FrequencyCode;
  pattern?: string;
  foodInstruction?: FoodInstruction;
}
export type InstructionField = keyof InstructionDraft;
export type InstructionErrors = Partial<Record<InstructionField, string>>;

const NOT_WRITTEN = "__none__";
const FREQUENCIES: readonly FrequencyCode[] = ["OD", "OD_AFTERNOON", "BD", "TDS", "HS", "SOS", "PATTERN", "WEEKLY", "FORTNIGHTLY", "MONTHLY"];
const PATTERNS = ["1-0-0", "1-0-1", "1-1-1", "0-0-1"] as const;
const FOODS: readonly FoodInstruction[] = ["before", "with", "after", "any", "bedtime"];

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <span role="alert" style={{ fontSize: "var(--font-small)", color: "var(--color-danger)", fontWeight: 600 }}>
      {message}
    </span>
  );
}

export function InstructionPickers({
  value,
  onChange,
  errors = {},
  optional = false,
}: {
  value: InstructionDraft;
  onChange: (next: InstructionDraft) => void;
  errors?: InstructionErrors;
  optional?: boolean;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<InstructionDraft>) => onChange({ ...value, ...patch });
  const notWritten = optional ? [{ value: NOT_WRITTEN, label: t("rx.not_written") }] : [];
  const countable = value.doseUnit === "tablet" || value.doseUnit === "capsule";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <ChoiceGrid
          label={t("add.dose_unit_label")}
          columns={2}
          choices={[...DOSE_UNITS.map((u) => ({ value: u as string, label: t(`medicineType.${u}` as never) })), ...notWritten]}
          value={value.doseUnit ?? (optional ? NOT_WRITTEN : undefined)}
          onChange={(u) => set({ doseUnit: u === NOT_WRITTEN ? undefined : (u as DoseUnit) })}
        />
        <FieldError message={errors.doseUnit} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        {countable || !value.doseUnit ? (
          <ChoiceGrid
            label={t("add.dose_label")}
            columns={3}
            choices={[
              { value: "0.5", label: "½" },
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              ...notWritten,
            ]}
            value={value.doseQuantity ?? (optional ? NOT_WRITTEN : undefined)}
            onChange={(q) => set({ doseQuantity: q === NOT_WRITTEN ? undefined : q })}
          />
        ) : (
          <TextInput
            label={t("add.dose_label")}
            help={t(`unit.${value.doseUnit}` as never)}
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0.1"
            value={value.doseQuantity ?? ""}
            onChange={(e) => set({ doseQuantity: e.target.value || undefined })}
          />
        )}
        <FieldError message={errors.doseQuantity} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <ChoiceGrid
          label={t("add.frequency_label")}
          choices={[...FREQUENCIES.map((f) => ({ value: f as string, label: t(`frequency.${f.toLowerCase()}` as never) })), ...notWritten]}
          value={value.frequencyCode ?? (optional ? NOT_WRITTEN : undefined)}
          onChange={(f) =>
            set({
              frequencyCode: f === NOT_WRITTEN ? undefined : (f as FrequencyCode),
              ...(f !== "PATTERN" ? { pattern: undefined } : {}),
            })
          }
        />
        <FieldError message={errors.frequencyCode} />
      </div>

      {value.frequencyCode === "PATTERN" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <ChoiceGrid
            label={t("frequency.pattern")}
            columns={4}
            choices={PATTERNS.map((p) => ({ value: p, label: p }))}
            value={value.pattern as (typeof PATTERNS)[number] | undefined}
            onChange={(p) => set({ pattern: p })}
          />
          <FieldError message={errors.pattern} />
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
        <ChoiceGrid
          label={t("add.food_label")}
          columns={2}
          choices={[...FOODS.map((f) => ({ value: f as string, label: t(`food.${f}` as never) })), ...notWritten]}
          value={value.foodInstruction ?? (optional ? NOT_WRITTEN : undefined)}
          onChange={(f) => set({ foodInstruction: f === NOT_WRITTEN ? undefined : (f as FoodInstruction) })}
        />
        <FieldError message={errors.foodInstruction} />
      </div>
    </div>
  );
}

/** The draft as the API's nullable line-item fields (unset = null = "not written"). */
export function draftToItemFields(d: InstructionDraft) {
  return {
    doseQuantity: d.doseQuantity ? Number(d.doseQuantity) : null,
    doseUnit: d.doseUnit ?? null,
    frequencyCode: d.frequencyCode ?? null,
    pattern: d.frequencyCode === "PATTERN" ? (d.pattern ?? null) : null,
    foodInstruction: d.foodInstruction ?? null,
  };
}
