"use client";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { TrustBadge } from "../../components/TrustBadge";
import { formatDateOnly, groupReportsByKind, useDiagnosticReports } from "../../lib/diagnostics";
import { useI18n } from "../../lib/i18n";
import { useReports } from "../../lib/reports";

/**
 * The diagnostics hub (docs_v2/06 P4-4): every lab and imaging report,
 * grouped by kind, newest first within each. Reads the V2 diagnostics
 * list; the V1 reports archive is shown only when that route does not
 * exist yet (an older API), never merged.
 */
export default function ReportsHubPage() {
  const { t, locale } = useI18n();
  const { items, unavailable, error } = useDiagnosticReports();

  if (unavailable) return <LegacyReportsList />;

  const groups = groupReportsByKind(items ?? []);

  return (
    <AppShell>
      <PageHeader title={t("reports.title")} readAloud={[{ audio: "screen.reports" }]} />
      {error && !items ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      <Link href="/reports/new">
        <Button fullWidth>{t("reports.add")}</Button>
      </Link>
      <Link href="/reports/values">
        <Button variant="secondary" fullWidth>
          {t("reports.values_history_link")}
        </Button>
      </Link>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState glyph="report" titleKey="reports.empty_title" bodyKey="dx.empty_body" cta={{ labelKey: "reports.add", href: "/reports/new" }} />
      ) : null}

      {groups.map(({ kind, reports }) => (
        <section key={kind} aria-label={t(`dx.kind.${kind}` as never)} data-testid={`dx-group-${kind}`}>
          <SectionTitle>{t(`dx.kind.${kind}` as never)}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {reports.map((r) => (
              <Link key={r.id} href={`/reports/${r.id}`}>
                <Card data-testid="dx-report-card">
                  <strong>{r.title}</strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {r.testedAt ? formatDateOnly(r.testedAt, locale) : t("reports.no_date")}
                    {r.facilityNameText ? ` · ${r.facilityNameText}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                    {r.resultCount > 0 ? <Chip>{t("dx.result_count", { count: r.resultCount })}</Chip> : null}
                    {r.modality ? <Chip>{t(`dx.modality.${r.modality}` as never)}</Chip> : null}
                    <TrustBadge verification={r.verification} provenanceSource={r.provenanceSource} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </AppShell>
  );
}

/** Screen 44 (docs/07): the V1 archive, unchanged — the fallback for an API without diagnostics. */
function LegacyReportsList() {
  const { t } = useI18n();
  const { items, error } = useReports();
  return (
    <AppShell>
      <PageHeader title={t("reports.title")} readAloud={[{ audio: "screen.reports" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      <Link href="/reports/new">
        <Button fullWidth>{t("reports.add")}</Button>
      </Link>
      <Link href="/reports/values">
        <Button variant="secondary" fullWidth>
          {t("reports.values_history_link")}
        </Button>
      </Link>
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}
      {items && items.length === 0 ? (
        <EmptyState glyph="report" titleKey="reports.empty_title" bodyKey="reports.empty_body" audioId="empty.reports" cta={{ labelKey: "reports.add", href: "/reports/new" }} />
      ) : null}
      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((r) => (
            <Link key={r.id} href={`/reports/${r.id}`}>
              <Card>
                <strong>{t(`reports.kind.${r.kind}` as never)}</strong>
                {r.label ? <div style={{ fontSize: "var(--font-small)" }}>{r.label}</div> : null}
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {r.testedAt ? new Date(r.testedAt).toLocaleDateString() : t("reports.no_date")}
                  {r.facilityName ? ` · ${r.facilityName}` : ""}
                </div>
                <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-xs)", flexWrap: "wrap" }}>
                  <Chip>{t("reports.document_count", { count: r.documentCount })}</Chip>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
