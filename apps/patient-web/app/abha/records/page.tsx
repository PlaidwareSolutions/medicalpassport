"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { bundleStatusLabelKey, hiTypeLabelKey, importBundle, useAbdmBundles, type AbdmBundleDto } from "../../../lib/abha";
import { useI18n } from "../../../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../../../lib/patient-time";

/**
 * Records received through ABDM (docs_v2/08 §7, M8B). "Import" here never
 * writes a clinical row: it turns the received bundle into a document with
 * candidates and hands the patient to the same "Check what we found" queue
 * every scanned prescription goes through — one confirmation per fact. A
 * hospital's copy of your record is still a claim about you until you say
 * it is right.
 */
export default function AbdmRecordsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const timezone = useActiveTimezone();
  const { items, error, fromCache, reload } = useAbdmBundles();
  const [busy, setBusy] = useState<string | undefined>();
  const [importError, setImportError] = useState<string | undefined>();

  async function runImport(bundle: AbdmBundleDto) {
    setBusy(bundle.id);
    setImportError(undefined);
    try {
      const res = await importBundle(bundle.id);
      await reload();
      // Straight into the existing confirmation queue — the import itself is
      // not the outcome the patient came for.
      router.push(`/documents/${res.documentId}/review`);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
      setBusy(undefined);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("abha.records_title")} readAloud={[{ text: `${t("abha.records_title")}. ${t("abha.records_intro")}` }]} />
      <p style={{ margin: "0 0 var(--space-md)" }}>{t("abha.records_intro")}</p>

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {importError ? <Banner tone="danger">{importError}</Banner> : null}

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState glyph="document" titleKey="abha.records_empty_title" bodyKey="abha.records_empty_body" cta={{ labelKey: "abha.care_contexts_link", href: "/abha/care-contexts" }} />
      ) : null}

      {items && items.length > 0 ? (
        <>
          <SectionTitle>{t("abha.records_list_title")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {items.map((bundle) => (
              <Card key={bundle.id} data-testid="abdm-bundle" data-status={bundle.importStatus}>
                <strong style={{ fontSize: "var(--font-large)" }}>{t(hiTypeLabelKey(bundle.hiType))}</strong>
                <Chip tone={bundle.importStatus === "candidates_created" ? "success" : bundle.importStatus === "received" ? "warning" : "default"}>
                  {t(bundleStatusLabelKey(bundle.importStatus))}
                </Chip>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t("abha.bundle_received_on", { date: formatPatientDate(bundle.createdAt, timezone) })}
                </span>
                {bundle.entryCount ? <span>{t("abha.bundle_entries", { n: bundle.entryCount })}</span> : null}

                {bundle.importStatus === "received" ? (
                  <>
                    <span>{t("abha.import_explains")}</span>
                    <Button fullWidth loading={busy === bundle.id} disabled={busy === bundle.id} onClick={() => void runImport(bundle)} data-testid="import-bundle">
                      {t("abha.import")}
                    </Button>
                  </>
                ) : null}
                {bundle.importStatus === "candidates_created" ? <span>{t("abha.import_done")}</span> : null}
                {bundle.importStatus === "rejected" ? <span>{t("abha.import_rejected")}</span> : null}
                {bundle.importStatus === "erased" ? <span>{t("abha.import_erased")}</span> : null}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Link href="/abha">
          <Button variant="ghost" fullWidth>
            {t("abha.back_to_abha")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
