"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { reportAnalyteById } from "@medpass/domain";
import { Banner, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AnalytePicker } from "../../../components/AnalytePicker";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { useI18n } from "../../../lib/i18n";
import { formatCalendarDate } from "../../../lib/patient-time";
import { useReportValueHistory } from "../../../lib/reports";

/** Date-only values (`YYYY-MM-DD`) must not go through a timezone-shifting Date parse. */
function formatDateOnly(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return formatCalendarDate(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * Screen 44 (docs/07): one analyte across every report — the trend the
 * structured values exist for. A plain newest-first list, no chart this
 * pass, each row linking back to its source report. Report values only:
 * check-up entries (screen 42) are deliberately never merged in.
 */
function ValueHistory() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const analyte = searchParams.get("analyte") ?? undefined;
  const { items, error } = useReportValueHistory(analyte);
  const selected = analyte ? reportAnalyteById(analyte) : undefined;

  return (
    <AppShell>
      <PageHeader title={t("reports.history_title")} readAloud={[{ audio: "screen.report_values" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      {!selected ? (
        <>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("reports.history_pick")}</span>
          <AnalytePicker value={undefined} onChange={(a) => router.replace(`/reports/values?analyte=${a}`)} includeOther={false} />
        </>
      ) : (
        <>
          <SectionTitle>
            {selected.label}
            {selected.unit ? ` (${selected.unit})` : ""}
          </SectionTitle>

          {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

          {items && items.length === 0 ? (
            <EmptyState
              glyph="report"
              titleKey="reports.history_empty_title"
              bodyKey="reports.history_empty_body"
              audioId="empty.report_history"
            />
          ) : null}

          {items && items.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {items.map((v) => (
                <Link key={v.id} href={`/reports/${v.reportId}`}>
                  <Card>
                    <strong style={{ fontSize: "var(--font-large)" }}>
                      {v.enteredValue}
                      {v.unit ? ` ${v.unit}` : ""}
                    </strong>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {formatDateOnly(v.testedAt ?? v.reportCreatedAt.slice(0, 10))}
                      {v.reportLabel ? ` · ${v.reportLabel}` : ""}
                      {v.facilityName ? ` · ${v.facilityName}` : ""}
                    </span>
                    {v.referenceText ? (
                      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                        {t("reports.reference_prefix", { range: v.referenceText })}
                      </span>
                    ) : null}
                  </Card>
                </Link>
              ))}
            </div>
          ) : null}

          <Link href="/reports/values" style={{ fontSize: "var(--font-small)" }}>
            {t("reports.history_pick_another")}
          </Link>
        </>
      )}

      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {t("reports.history_source_note")}
      </span>
    </AppShell>
  );
}

/** useSearchParams needs a Suspense boundary for static prerendering. */
export default function ReportValueHistoryPage() {
  return (
    <Suspense>
      <ValueHistory />
    </Suspense>
  );
}
