"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import {
  CHOOSABLE_KINDS,
  chooserKindFor,
  deleteDocument,
  isDocumentKind,
  kindLabelKey,
  processDocument,
  updateDocument,
  useDocument,
  type DocumentKind,
  type DocumentStatus,
} from "../../../lib/documents";
import { useI18n } from "../../../lib/i18n";
import { formatCalendarDate, formatPatientDate, useActiveTimezone } from "../../../lib/patient-time";

const POLL_MS = 2000;

function statusChip(status: DocumentStatus, extractionStatus: string | null | undefined): { key: "documents.status.uploading" | "documents.status.reading" | "documents.status.ready" | "documents.status.failed" | "documents.status.quarantined"; tone: "default" | "success" | "warning" | "danger" } {
  if (status === "pending_upload" || status === "uploaded") return { key: "documents.status.uploading", tone: "warning" };
  if (status === "processing") return { key: "documents.status.reading", tone: "default" };
  if (status === "quarantined") return { key: "documents.status.quarantined", tone: "danger" };
  if (status === "failed" || extractionStatus === "failed") return { key: "documents.status.failed", tone: "warning" };
  return { key: "documents.status.ready", tone: "success" };
}

/**
 * One document (docs_v2/09 §10): its pages exactly as uploaded, what it is,
 * what it is attached to, and the way into "Check what we found". Deleting
 * is a soft delete — the originals stay under the retention policy
 * (docs_v2/09 §1 rule 1) — and it is confirmed in words first.
 */
export default function DocumentDetailPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { document: doc, error, reload, mutate } = useDocument(params.id);
  const [actionError, setActionError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [changingKind, setChangingKind] = useState(false);
  const [kind, setKind] = useState<DocumentKind | undefined>();

  // Still being read: poll so the "Review" button appears without a refresh.
  useEffect(() => {
    if (!doc || doc.status !== "processing") return;
    const timer = setTimeout(() => void reload(), POLL_MS);
    return () => clearTimeout(timer);
  }, [doc, reload]);

  async function changeKind() {
    if (!kind) return;
    setBusy(true);
    setActionError(undefined);
    try {
      const updated = await updateDocument(params.id, { kind });
      mutate(updated);
      setChangingKind(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    setActionError(undefined);
    try {
      mutate(await processDocument(params.id));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("documents.delete_confirm"))) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await deleteDocument(params.id);
      router.replace("/documents");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
      setBusy(false);
    }
  }

  if (error && !doc) {
    return (
      <AppShell>
        <PageHeader title={t("documents.detail_title")} />
        <Banner tone="danger">{t("common.error_generic")}</Banner>
        <Link href="/documents">
          <Button variant="secondary" fullWidth>
            {t("documents.back_to_list")}
          </Button>
        </Link>
      </AppShell>
    );
  }
  if (!doc) {
    return (
      <AppShell>
        <PageHeader title={t("documents.detail_title")} />
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  const chip = statusChip(doc.status, doc.extraction?.status);
  const kindLabel = t(kindLabelKey(doc.kind));
  const reviewable = doc.status === "processed" || doc.status === "processing" || !!doc.extraction;
  const isDischarge = doc.kind === "discharge_summary";
  const links: Array<{ key: "documents.link_prescription" | "documents.link_report" | "documents.link_visit" | "documents.link_immunization"; href: string }> = [];
  if (doc.prescriptionId) links.push({ key: "documents.link_prescription", href: `/prescriptions/${doc.prescriptionId}` });
  if (doc.diagnosticReportId) links.push({ key: "documents.link_report", href: `/reports/${doc.diagnosticReportId}` });
  if (doc.encounterId) links.push({ key: "documents.link_visit", href: `/health/visits/${doc.encounterId}` });
  if (doc.immunizationId) links.push({ key: "documents.link_immunization", href: "/immunizations" });

  return (
    <AppShell>
      <PageHeader title={doc.title ?? kindLabel} right={<Chip tone={chip.tone}>{t(chip.key)}</Chip>} readAloud={[{ audio: "screen.document_detail" }]} />
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {doc.status === "quarantined" ? <Banner tone="danger">{t("documents.quarantined")}</Banner> : null}

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-sm)", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <strong data-testid="document-kind">{kindLabel}</strong>
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t("documents.pages_count", { n: doc.pageCount })} · {doc.documentDate ? formatCalendarDate(doc.documentDate) : formatPatientDate(doc.createdAt, timezone)}
            </div>
            {doc.classification.kind && doc.classification.classifiedBy !== "user" && chooserKindFor(doc.classification.kind) !== chooserKindFor(doc.kind) ? (
              <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {t("documents.classifier_said", { kind: t(kindLabelKey(doc.classification.kind)) })}
              </div>
            ) : null}
          </div>
          <Button
            variant="ghost"
            aria-expanded={changingKind}
            disabled={busy}
            onClick={() => {
              setKind(chooserKindFor(doc.kind));
              setChangingKind((v) => !v);
            }}
          >
            {t("documents.change_kind")}
          </Button>
        </div>
        {changingKind ? (
          <>
            <ChoiceGrid
              label={t("documents.kind_label")}
              columns={2}
              choices={CHOOSABLE_KINDS.map((k) => ({ value: k, label: t(kindLabelKey(k)) }))}
              value={kind}
              onChange={(v) => setKind(isDocumentKind(v) ? v : undefined)}
            />
            <Button fullWidth disabled={!kind || busy} loading={busy} onClick={() => void changeKind()}>
              {t("common.save")}
            </Button>
          </>
        ) : null}
      </Card>

      {isDischarge ? (
        <Card tone="info">
          <strong>{t("documents.discharge_title")}</strong>
          <span>{t("documents.discharge_short")}</span>
          <Link href={`/documents/${doc.id}/discharge`}>
            <Button variant="secondary" fullWidth>
              {t("documents.discharge_more")}
            </Button>
          </Link>
        </Card>
      ) : doc.status === "failed" || doc.extraction?.status === "failed" ? (
        <Card tone="warning">
          <span>{t("scan.process_error")}</span>
          <Button variant="secondary" fullWidth disabled={busy} loading={busy} onClick={() => void retry()}>
            {t("scan.try_again")}
          </Button>
        </Card>
      ) : reviewable ? (
        <Link href={`/documents/${doc.id}/review`}>
          <Button fullWidth>{doc.status === "processing" ? t("documents.status.reading") : t("documents.review_cta")}</Button>
        </Link>
      ) : null}

      {links.length > 0 ? (
        <>
          <SectionTitle>{t("documents.links_title")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {links.map((l) => (
              <Link key={l.key} href={l.href}>
                <Button variant="secondary" fullWidth>
                  {t(l.key)}
                </Button>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <SectionTitle>{t("documents.pages_title", { n: doc.pages.length })}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {doc.pages.map((p) => (
          <Card key={p.pageNumber} data-testid="document-page">
            <strong>{t("documents.page_n", { n: p.pageNumber })}</strong>
            {p.status !== "verified" ? (
              <Chip tone="warning">{p.status === "quarantined" ? t("documents.status.quarantined") : t("documents.status.uploading")}</Chip>
            ) : p.contentType === "application/pdf" ? (
              p.downloadUrl ? (
                <a href={p.downloadUrl} target="_blank" rel="noopener noreferrer">
                  {t("documents.open_pdf_page", { n: p.pageNumber })}
                </a>
              ) : null
            ) : p.downloadUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- presigned, short-lived URL; never proxied through image optimisation
              <img src={p.downloadUrl} alt={t("documents.page_alt", { n: p.pageNumber })} style={{ width: "100%", height: "auto", borderRadius: "var(--radius-sm)" }} />
            ) : (
              <span style={{ color: "var(--color-text-muted)" }}>{t("documents.page_unavailable")}</span>
            )}
          </Card>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-xl)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <Link href="/documents">
          <Button variant="ghost" fullWidth>
            {t("documents.back_to_list")}
          </Button>
        </Link>
        <Button variant="danger" fullWidth disabled={busy} onClick={() => void remove()}>
          {t("documents.delete")}
        </Button>
      </div>
    </AppShell>
  );
}
