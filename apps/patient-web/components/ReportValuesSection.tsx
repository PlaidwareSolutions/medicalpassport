"use client";
import { useState } from "react";
import Link from "next/link";
import { ApiError, type ReportValueDto } from "@medpass/api-client";
import { reportAnalyteById } from "@medpass/domain";
import { Banner, Button, Card, SectionTitle, TextInput } from "@medpass/ui-web";
import { AnalytePicker } from "./AnalytePicker";
import { useI18n } from "../lib/i18n";
import { EmptyState } from "./EmptyState";

/**
 * The structured-values block on a report detail screen (docs/07 screen 44):
 * the recorded values, then an add-one-at-a-time inline form — the
 * blood-sugar screen's pattern, add and delete only, no edit (a typo is
 * delete + re-add; the entered text is immutable by design).
 *
 * Everything shown is the entered text verbatim beside its canonical unit.
 * No colour, no high/low flag — the reference range is displayed exactly as
 * transcribed and never compared (docs/02: not a diagnostic system;
 * docs/10 H-25).
 */
export function ReportValuesSection({
  values,
  onAdd,
  onDelete,
}: {
  values: ReportValueDto[];
  onAdd: (input: { analyte: string; otherLabel?: string; enteredValue: string; referenceText?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [analyte, setAnalyte] = useState<string | undefined>();
  const [otherLabel, setOtherLabel] = useState("");
  const [enteredValue, setEnteredValue] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const selected = analyte ? reportAnalyteById(analyte) : undefined;
  const canSave = Boolean(analyte && enteredValue.trim() && (analyte !== "other" || otherLabel.trim()));

  async function save() {
    if (!analyte) return;
    setBusy(true);
    setError(undefined);
    try {
      await onAdd({
        analyte,
        ...(analyte === "other" ? { otherLabel: otherLabel.trim() } : {}),
        enteredValue: enteredValue.trim(),
        ...(referenceText.trim() ? { referenceText: referenceText.trim() } : {}),
      });
      setShowForm(false);
      setAnalyte(undefined);
      setOtherLabel("");
      setEnteredValue("");
      setReferenceText("");
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("reports.value_delete_confirm"))) return;
    setBusy(true);
    setError(undefined);
    try {
      await onDelete(id);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>{t("reports.values_title")}</SectionTitle>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {values.length === 0 && !showForm ? (
        <EmptyState
          glyph="report"
          titleKey="reports.values_empty_title"
          bodyKey="reports.values_empty_body"
          audioId="empty.report_values"
        />
      ) : null}

      {values.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {values.map((v) => (
            <Card key={v.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
                <div style={{ minWidth: 0 }}>
                  {/* Tapping the name opens this analyte's history across all
                      reports — `other` has no shared identity to trend. */}
                  {v.analyte !== "other" ? (
                    <Link href={`/reports/values?analyte=${v.analyte}`} style={{ textDecoration: "none", color: "inherit" }}>
                      <strong>{v.label}</strong>
                    </Link>
                  ) : (
                    <strong>{v.label}</strong>
                  )}
                  <div>
                    {v.enteredValue}
                    {v.unit ? ` ${v.unit}` : ""}
                  </div>
                  {v.referenceText ? (
                    <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {t("reports.reference_prefix", { range: v.referenceText })}
                    </div>
                  ) : null}
                </div>
                <Button variant="ghost" disabled={busy} onClick={() => void remove(v.id)} aria-label={t("reports.value_delete")}>
                  ✕
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          <AnalytePicker value={analyte} onChange={setAnalyte} />
          {analyte === "other" ? (
            <TextInput
              label={t("reports.other_label_label")}
              placeholder={t("reports.other_label_placeholder")}
              value={otherLabel}
              onChange={(e) => setOtherLabel(e.target.value)}
            />
          ) : null}
          {analyte ? (
            <>
              <TextInput
                label={
                  selected?.unit
                    ? t("reports.value_label", { unit: selected.unit })
                    : t("reports.value_label_no_unit")
                }
                value={enteredValue}
                onChange={(e) => setEnteredValue(e.target.value)}
              />
              <TextInput
                label={t("reports.reference_label")}
                placeholder={t("reports.reference_placeholder")}
                help={t("reports.reference_help")}
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
              />
            </>
          ) : null}
          <div style={{ display: "flex", gap: "var(--size-touch-gap)" }}>
            <Button fullWidth loading={busy} disabled={busy || !canSave} onClick={() => void save()}>
              {t("reports.value_save")}
            </Button>
            <Button variant="ghost" fullWidth disabled={busy} onClick={() => setShowForm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : (
        <Button variant="secondary" fullWidth onClick={() => setShowForm(true)}>
          {t("reports.add_value")}
        </Button>
      )}
    </>
  );
}
