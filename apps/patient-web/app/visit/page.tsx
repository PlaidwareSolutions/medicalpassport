"use client";
import { useState } from "react";
import Link from "next/link";
import { Banner, Button, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { ReadAloud } from "../../components/ReadAloud";
import { VisitSummarySections } from "../../components/VisitSummarySections";
import { useI18n } from "../../lib/i18n";
import { formatPatientDateTime } from "../../lib/patient-time";
import { downloadVisitSummaryPdf, useVisitSummary } from "../../lib/sharing";

/**
 * Screen 28: doctor-visit mode (docs/07). Dense but readable, designed to
 * work offline (cached) and be read at arm's length in a clinic.
 */
export default function VisitModePage() {
  const { t } = useI18n();
  const { data, error } = useVisitSummary();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | undefined>();

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(undefined);
    try {
      await downloadVisitSummaryPdf();
    } catch {
      setDownloadError(t("visit.download_error"));
    } finally {
      setDownloading(false);
    }
  }

  if (error) {
    return (
      <AppShell>
        <Banner tone="danger">{t("common.error_generic")}</Banner>
      </AppShell>
    );
  }
  if (!data) {
    return (
      <AppShell>
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-xs)" }}>{data.profile.displayName}</h1>
      <p style={{ margin: "0 0 var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {t("visit.generated_at", { time: formatPatientDateTime(data.generatedAt, data.profile.timezone) })}
      </p>
      <div style={{ margin: "0 0 var(--space-sm)" }}>
        <ReadAloud size="md" segments={[{ audio: "screen.visit" }]} />
      </div>

      {downloadError ? <Banner tone="danger">{downloadError}</Banner> : null}

      <Link href="/share/new">
        <Button fullWidth>{t("visit.share_button")}</Button>
      </Link>
      <div style={{ height: "var(--space-sm)" }} />
      <Button variant="secondary" fullWidth disabled={downloading} onClick={() => void handleDownload()}>
        {t("visit.download_pdf")}
      </Button>

      <VisitSummarySections data={data} />
    </AppShell>
  );
}
