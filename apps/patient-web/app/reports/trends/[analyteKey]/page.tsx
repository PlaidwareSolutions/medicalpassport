"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Banner, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { EmptyState } from "../../../../components/EmptyState";
import { PageHeader } from "../../../../components/PageHeader";
import { TrendChart, type TrendBand } from "../../../../components/TrendChart";
import { analyteLabel, formatAnalyteValue, referenceRangeText, useResultTrend } from "../../../../lib/diagnostics";
import { useI18n } from "../../../../lib/i18n";
import { formatCalendarDate } from "../../../../lib/patient-time";

/**
 * One analyte across every report (docs_v2/04 §6.4, docs_v2/06 P4-4): every
 * convertible point in the canonical unit, the unit on the axis, a
 * reference band only when the latest report printed a structured range,
 * a table alternative, and the points the terminology layer could not
 * convert listed separately with their own unit (H-35/H-39 — never
 * silently merged, never silently dropped). No point is coloured or
 * flagged by its value.
 */
export default function ResultTrendPage() {
  const { t, locale, tn } = useI18n();
  const params = useParams<{ analyteKey: string }>();
  const { trend, error } = useResultTrend(params.analyteKey);

  if (error && !trend) {
    return (
      <AppShell>
        <Banner tone="danger">{t("common.error_generic")}</Banner>
      </AppShell>
    );
  }
  if (!trend) {
    return (
      <AppShell>
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  const unit = trend.canonicalUnitDisplay ?? trend.canonicalUnit ?? "";
  // The analyte's name in the reader's language; the picker keeps English
  // on purpose (docs/34), a heading about the patient's own record does not.
  const name = analyteLabel(t, trend.analyteKey, trend.label);
  /** A stored unit code as printed: the canonical display, else the allowed-unit table, else the code itself. */
  const unitOf = (code: string | null) => (code ? (code === trend.canonicalUnit ? unit : (trend.allowedEnteredUnits.find((u) => u.unit === code)?.display ?? code)) : "");
  const latestWithRange = [...trend.points].reverse().find((p) => p.referenceLow != null || p.referenceHigh != null);
  const band: TrendBand | null = latestWithRange
    ? {
        low: latestWithRange.referenceLow != null ? Number(latestWithRange.referenceLow) : null,
        high: latestWithRange.referenceHigh != null ? Number(latestWithRange.referenceHigh) : null,
        label: t("trend.band_label", { date: formatCalendarDate(latestWithRange.at) }),
      }
    : null;
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(locale === "en" ? undefined : locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <AppShell>
      <PageHeader title={t("trend.title", { name })} readAloud={[{ audio: "screen.result_trend" }]} />

      {trend.points.length === 0 && trend.unconvertible.length === 0 ? (
        <EmptyState glyph="report" titleKey="reports.history_empty_title" bodyKey="trend.empty_body" cta={{ labelKey: "reports.add", href: "/reports/new" }} />
      ) : null}

      {trend.points.length > 0 ? (
        <Card>
          <TrendChart
            series={[
              {
                key: trend.analyteKey,
                label: name,
                marker: "circle",
                points: trend.points.map((p) => ({
                  id: p.resultId,
                  x: new Date(p.at).getTime(),
                  y: p.value,
                  label: `${p.enteredValueText}${p.enteredUnit ? ` ${unitOf(p.enteredUnit)}` : unit ? ` ${unit}` : ""} · ${dateOf(p.at)}`,
                })),
              },
            ]}
            unit={unit}
            band={band}
            formatX={(x) => new Date(x).toLocaleDateString(locale === "en" ? undefined : locale, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" })}
            ariaLabel={tn(trend.points.length, "trend.chart_aria_one", "trend.chart_aria", { name, unit })}
            tableCaption={t("trend.table_caption", { name, unit })}
            tableHeaders={[t("trend.col_date"), t("trend.col_entered"), t("trend.col_canonical", { unit }), t("trend.col_range"), t("trend.col_report")]}
            tableRows={trend.points.map((p) => ({
              id: p.resultId,
              cells: [
                dateOf(p.at),
                `${p.comparator ?? ""}${p.enteredValueText}${p.enteredUnit ? ` ${unitOf(p.enteredUnit)}` : ""}`,
                `${formatAnalyteValue(p.value, trend.analyteKey)} ${unit}`,
                [referenceRangeText(p) ?? "", p.interpretation ? t("dx.lab_flag", { flag: t(`dx.interpretation.${p.interpretation}` as never) }) : ""]
                  .filter(Boolean)
                  .join(" · ") || "—",
                <Link key={p.reportId} href={`/reports/${p.reportId}`} style={{ color: "var(--color-info)", textDecoration: "underline" }}>
                  {p.reportTitle}
                </Link>,
              ],
            }))}
          />
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("trend.no_judgement_note")}</span>
        </Card>
      ) : null}

      {trend.unconvertible.length > 0 ? (
        <>
          <SectionTitle>{t("trend.unconvertible_title")}</SectionTitle>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("trend.unconvertible_help", { unit })}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }} data-testid="trend-unconvertible">
            {trend.unconvertible.map((u) => (
              <Link key={u.resultId} href={`/reports/${u.reportId}`}>
                <Card>
                  <strong style={{ fontSize: "var(--font-large)" }}>
                    {u.enteredValueText}
                    {u.enteredUnit ? ` ${unitOf(u.enteredUnit)}` : ""}
                  </strong>
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {dateOf(u.at)} · {u.reportTitle}
                  </span>
                  <span style={{ fontSize: "var(--font-small)" }}>{t(`trend.reason.${u.reason}` as never)}</span>
                </Card>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
