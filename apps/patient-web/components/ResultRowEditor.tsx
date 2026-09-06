"use client";
import { useMemo } from "react";
import { REPORT_ANALYTE_GROUP_LABELS, REPORT_ANALYTE_GROUPS, type ReportAnalyteGroup } from "@medpass/domain";
import { Button, ChoiceGrid, TextInput } from "@medpass/ui-web";
import type { AddDiagnosticResultInput, AnalyteTerminologyDto } from "../lib/diagnostics";
import { useI18n } from "../lib/i18n";

/**
 * One result row as the patient transcribes it (docs_v2/06 P4-4, H-35): the
 * test from the terminology vocabulary, the value exactly as printed, the
 * unit chosen from THAT analyte's allowed units only (canonical first —
 * never a free-typed unit, so mg/dL vs mmol/L is a deliberate tap), and the
 * range the lab printed. Nothing here compares the value to the range.
 */
export interface ResultDraft {
  key: string;
  analyteKey?: string;
  otherLabel: string;
  value: string;
  unit?: string;
  referenceLow: string;
  referenceHigh: string;
  referenceText: string;
}

let counter = 0;
export function emptyResult(): ResultDraft {
  counter += 1;
  return { key: `result-${counter}`, otherLabel: "", value: "", referenceLow: "", referenceHigh: "", referenceText: "" };
}

export function resultIsComplete(d: ResultDraft): boolean {
  return Boolean(d.analyteKey && d.value.trim() && (d.analyteKey !== "other" || d.otherLabel.trim()));
}

export function resultToInput(d: ResultDraft, sequence: number): AddDiagnosticResultInput {
  return {
    analyteKey: d.analyteKey!,
    enteredValueText: d.value.trim(),
    sequence,
    ...(d.analyteKey === "other" ? { analyteLabelText: d.otherLabel.trim() } : {}),
    ...(d.unit ? { enteredUnit: d.unit } : {}),
    ...(d.referenceLow.trim() && Number.isFinite(Number(d.referenceLow)) ? { referenceLow: Number(d.referenceLow) } : {}),
    ...(d.referenceHigh.trim() && Number.isFinite(Number(d.referenceHigh)) ? { referenceHigh: Number(d.referenceHigh) } : {}),
    ...(d.referenceText.trim() ? { referenceText: d.referenceText.trim() } : {}),
  };
}

export function ResultRowEditor({
  draft,
  index,
  analytes,
  onChange,
  onRemove,
}: {
  draft: ResultDraft;
  index: number;
  analytes: AnalyteTerminologyDto[] | undefined;
  onChange: (next: ResultDraft) => void;
  onRemove?: () => void;
}) {
  const { t } = useI18n();
  const selected = analytes?.find((a) => a.key === draft.analyteKey);
  const groups = useMemo(() => {
    const known = new Set<string>(REPORT_ANALYTE_GROUPS);
    const extra = [...new Set((analytes ?? []).map((a) => a.group).filter((g) => !known.has(g)))];
    return [...REPORT_ANALYTE_GROUPS, ...extra];
  }, [analytes]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }} data-testid="result-row">
      <strong>{t("dx.result_n", { n: index + 1 })}</strong>
      {!selected ? (
        analytes === undefined ? (
          <span style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {groups.map((group) => {
              const list = analytes.filter((a) => a.group === group);
              if (list.length === 0) return null;
              return (
                <ChoiceGrid
                  key={group}
                  label={REPORT_ANALYTE_GROUP_LABELS[group as ReportAnalyteGroup] ?? group}
                  columns={2}
                  choices={list.map((a) => ({ value: a.key, label: a.display, description: a.canonicalUnitDisplay ?? undefined }))}
                  value={draft.analyteKey}
                  onChange={(key) => {
                    const analyte = analytes.find((a) => a.key === key);
                    onChange({ ...draft, analyteKey: key, unit: analyte?.canonicalUnit ?? undefined });
                  }}
                />
              );
            })}
          </div>
        )
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--font-large)", fontWeight: 600 }}>{selected.display}</span>
            <Button variant="ghost" onClick={() => onChange({ ...draft, analyteKey: undefined, unit: undefined })}>
              {t("dx.change_test")}
            </Button>
          </div>
          {selected.openEntry ? (
            <TextInput
              label={t("reports.other_label_label")}
              placeholder={t("reports.other_label_placeholder")}
              value={draft.otherLabel}
              onChange={(e) => onChange({ ...draft, otherLabel: e.target.value })}
            />
          ) : null}
          <TextInput
            label={t("dx.value_label")}
            help={t("dx.value_help")}
            inputMode="decimal"
            value={draft.value}
            onChange={(e) => onChange({ ...draft, value: e.target.value })}
          />
          {selected.allowedEnteredUnits.length > 0 ? (
            <ChoiceGrid
              label={t("dx.unit_label")}
              columns={selected.allowedEnteredUnits.length > 2 ? 2 : selected.allowedEnteredUnits.length}
              choices={selected.allowedEnteredUnits.map((u) => ({
                value: u.unit,
                label: u.display,
                description: u.isCanonical ? t("dx.unit_canonical") : undefined,
              }))}
              value={draft.unit}
              onChange={(unit) => onChange({ ...draft, unit })}
            />
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--size-touch-gap)" }}>
            <TextInput
              label={t("dx.reference_low_label")}
              inputMode="decimal"
              value={draft.referenceLow}
              onChange={(e) => onChange({ ...draft, referenceLow: e.target.value })}
            />
            <TextInput
              label={t("dx.reference_high_label")}
              inputMode="decimal"
              value={draft.referenceHigh}
              onChange={(e) => onChange({ ...draft, referenceHigh: e.target.value })}
            />
          </div>
          <TextInput
            label={t("reports.reference_label")}
            placeholder={t("reports.reference_placeholder")}
            help={t("reports.reference_help")}
            value={draft.referenceText}
            onChange={(e) => onChange({ ...draft, referenceText: e.target.value })}
          />
        </>
      )}
      {onRemove ? (
        <Button variant="ghost" fullWidth onClick={onRemove}>
          {t("dx.result_remove")}
        </Button>
      ) : null}
    </div>
  );
}
