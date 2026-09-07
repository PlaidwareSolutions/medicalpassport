"use client";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { attachPagesToRecord, kindGlyph, kindLabelKey, useLinkedDocuments, type DocumentKind } from "../lib/documents";
import { useI18n } from "../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../lib/patient-time";
import { DocumentUploadButtons } from "./DocumentUploadButtons";
import { GuideGlyph } from "./GuideGlyph";

type LinkProps = { prescriptionId: string } | { diagnosticReportId: string; reportKind: DocumentKind };

/**
 * The V2 documents a prescription or report was read from (docs_v2/09 §1
 * rule 2 — every record walks back to its pages), plus, for a report, the
 * way to add them: a photo of the paper, taken from the report's own
 * screen. A later photo lands as a new page of the same document, so a
 * report filed with one page can grow (docs/07 §43/44). Prescriptions keep
 * their own V1 attach buttons, so this offers none for them.
 */
export function LinkedDocumentsSection(props: LinkProps) {
  const { t, tn } = useI18n();
  const timezone = useActiveTimezone();
  const link = "prescriptionId" in props ? { prescriptionId: props.prescriptionId } : { diagnosticReportId: props.diagnosticReportId };
  const { items, error: loadError, reload } = useLinkedDocuments(link);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const canAttach = "diagnosticReportId" in props;

  async function attach(files: File[], channel: "camera" | "gallery") {
    if (!("diagnosticReportId" in props)) return;
    setBusy(true);
    setError(undefined);
    try {
      await attachPagesToRecord(link, props.reportKind, files, channel, items?.[0]?.id);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("scan.upload_error"));
    } finally {
      setBusy(false);
    }
  }

  if (!canAttach && (!items || items.length === 0)) return null;

  return (
    <section aria-label={t("documents.linked_title")} data-testid="linked-documents">
      <SectionTitle>{t("documents.linked_title")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {(items ?? []).map((d) => (
          <Link key={d.id} href={`/documents/${d.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                <span style={{ color: "var(--color-primary)" }}>
                  <GuideGlyph name={kindGlyph(d.kind)} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{d.title ?? t(kindLabelKey(d.kind))}</strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {tn(d.pageCount, "documents.pages_count_one", "documents.pages_count")} · {formatPatientDate(d.createdAt, timezone)}
                  </div>
                </div>
                <Chip>{t("documents.open")}</Chip>
              </div>
            </Card>
          </Link>
        ))}
        {canAttach ? (
          busy ? (
            <PillSpinner />
          ) : (
            <DocumentUploadButtons photoLabel={t("reports.take_photo")} fileLabel={t("reports.choose_file")} onPick={(files, channel) => void attach(files, channel)} />
          )
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {loadError ? <Banner tone="danger">{loadError}</Banner> : null}
      </div>
    </section>
  );
}
