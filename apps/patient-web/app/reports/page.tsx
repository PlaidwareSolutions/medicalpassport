"use client";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { useReports } from "../../lib/reports";

/** Screen 44 (docs/07): the archive of test reports, newest test first. */
export default function ReportsPage() {
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
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("reports.empty")}</span>
        </Card>
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
