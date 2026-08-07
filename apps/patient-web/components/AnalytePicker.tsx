"use client";
import {
  REPORT_ANALYTES,
  REPORT_ANALYTE_GROUPS,
  REPORT_ANALYTE_GROUP_LABELS,
  type ReportAnalyteGroup,
} from "@medpass/domain";
import { ChoiceGrid } from "@medpass/ui-web";

/**
 * The closed analyte vocabulary as a grouped, typing-free picker — nine
 * panel headings each with a 2-column ChoiceGrid, one scrollable run. ~30
 * items is long but linear and scannable; a type-to-filter box was
 * deliberately rejected (docs/01: typing-hostile personas are the target).
 *
 * Labels come straight from REPORT_ANALYTES and are deliberately English:
 * the patient is matching against a lab report printed in English, so the
 * picker must say exactly what the paper says (see the vocabulary's header
 * comment). The chrome around this component is localized as usual.
 */
export function AnalytePicker({
  value,
  onChange,
  includeOther = true,
}: {
  value: string | undefined;
  onChange: (analyte: string) => void;
  /** History has no `other` — free-labelled values share no identity to trend. */
  includeOther?: boolean;
}) {
  const groups = REPORT_ANALYTE_GROUPS.filter((g) => includeOther || g !== "other");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      {groups.map((group: ReportAnalyteGroup) => {
        const analytes = REPORT_ANALYTES.filter((a) => a.group === group);
        if (analytes.length === 0) return null;
        return (
          <ChoiceGrid
            key={group}
            label={REPORT_ANALYTE_GROUP_LABELS[group]}
            columns={2}
            choices={analytes.map((a) => ({ value: a.id, label: a.label }))}
            value={value}
            onChange={onChange}
          />
        );
      })}
    </div>
  );
}
