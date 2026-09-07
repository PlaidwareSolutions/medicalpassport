"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { GuideGlyph } from "../../components/GuideGlyph";
import { PageHeader } from "../../components/PageHeader";
import { ScopeGate } from "../../components/ScopeGate";
import { FILTER_KINDS, isDocumentKind, kindGlyph, kindLabelKey, useDocuments, type DocumentKind, type DocumentSummaryDto } from "../../lib/documents";
import { useI18n } from "../../lib/i18n";
import { useProfileAccess } from "../../lib/scopes";
import { formatCalendarDate, formatPatientDate, useActiveTimezone } from "../../lib/patient-time";

function statusOf(d: DocumentSummaryDto): { key: "documents.status.uploading" | "documents.status.reading" | "documents.status.ready" | "documents.status.failed" | "documents.status.quarantined"; tone: "default" | "success" | "warning" | "danger" } {
  if (d.status === "pending_upload" || d.status === "uploaded") return { key: "documents.status.uploading", tone: "warning" };
  if (d.status === "processing") return { key: "documents.status.reading", tone: "default" };
  if (d.status === "quarantined") return { key: "documents.status.quarantined", tone: "danger" };
  if (d.status === "failed" || d.extractionStatus === "failed") return { key: "documents.status.failed", tone: "warning" };
  return { key: "documents.status.ready", tone: "success" };
}

/**
 * Documents (docs_v2/09 §10): every page-set the patient has filed, newest
 * first, with one "Add a document" entry point. Kind chips narrow the list
 * (single-select — a document has exactly one kind); the cursor pages in
 * behind a plain "Show more" button.
 */
export default function DocumentsPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();

  const [kind, setKind] = useState<DocumentKind | undefined>();
  const { items, error, fromCache, hasMore, loadMore, loadingMore } = useDocuments(kind);
  const canUpload = useProfileAccess().can("upload_documents");

  // The chips are the common kinds plus whatever this patient actually has.
  // A doctor's note or a vaccination record could not be filtered to before
  // (found in the 2026-09-07 UI review) — only found under "All". Read while
  // "All" is showing, and kept, so filtering never shortens the row.
  const [extraKinds, setExtraKinds] = useState<readonly DocumentKind[]>([]);
  useEffect(() => {
    if (kind !== undefined || items === undefined) return;
    const present = items.map((d) => d.kind).filter(isDocumentKind).filter((k) => !FILTER_KINDS.includes(k));
    setExtraKinds((prev) => {
      const next = [...new Set([...prev, ...present])];
      return next.length === prev.length ? prev : next;
    });
  }, [items, kind]);
  const filterKinds = useMemo(() => [...FILTER_KINDS, ...extraKinds], [extraKinds]);

  return (
    <AppShell>
      <PageHeader title={t("documents.title")} readAloud={[{ audio: "screen.documents" }]} />

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}

      {/* Uploading a document is its own permission now (docs_v2/04 §2.2):
          a caregiver trusted to read the file cabinet is not automatically
          trusted to put things in it. */}
      <ScopeGate action="upload_documents">
        <Link href="/documents/new">
          <Button fullWidth>{t("documents.add")}</Button>
        </Link>
      </ScopeGate>

      <div role="group" aria-label={t("documents.filter_label")} style={{ display: "flex", flexWrap: "wrap", gap: "var(--size-touch-gap)", margin: "var(--space-sm) 0" }}>
        <Button variant={kind === undefined ? "primary" : "secondary"} aria-pressed={kind === undefined} onClick={() => setKind(undefined)} style={{ flex: "1 1 auto" }}>
          {t("documents.filter_all")}
        </Button>
        {filterKinds.map((k) => (
          <Button key={k} variant={kind === k ? "primary" : "secondary"} aria-pressed={kind === k} onClick={() => setKind(kind === k ? undefined : k)} style={{ flex: "1 1 auto" }}>
            {t(kindLabelKey(k))}
          </Button>
        ))}
      </div>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        kind === undefined ? (
          <EmptyState
            glyph="document"
            titleKey="documents.empty_title"
            bodyKey="documents.empty_body"
            cta={canUpload ? { labelKey: "documents.add", href: "/documents/new" } : undefined}
          />
        ) : (
          <Card tone="info">
            <span style={{ color: "var(--color-text-muted)" }}>{t("documents.filter_empty")}</span>
          </Card>
        )
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {(items ?? []).map((d) => {
          const status = statusOf(d);
          return (
            <Link key={d.id} href={`/documents/${d.id}`} data-testid="document-row" data-kind={d.kind} style={{ textDecoration: "none", color: "inherit" }}>
              <Card>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                  <span style={{ color: "var(--color-primary)", flexShrink: 0 }}>
                    <GuideGlyph name={kindGlyph(d.kind)} size="lg" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ overflowWrap: "anywhere" }}>{d.title ?? t(kindLabelKey(d.kind))}</strong>
                    <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {d.title ? `${t(kindLabelKey(d.kind))} · ` : ""}
                      {t("documents.pages_count", { n: d.pageCount })} · {d.documentDate ? formatCalendarDate(d.documentDate) : formatPatientDate(d.createdAt, timezone)}
                    </div>
                  </div>
                </div>
                <div>
                  <Chip tone={status.tone}>{t(status.key)}</Chip>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {hasMore ? (
        <div style={{ marginTop: "var(--space-md)" }}>
          <Button variant="secondary" fullWidth loading={loadingMore} disabled={loadingMore} onClick={() => void loadMore()}>
            {t("health.show_more")}
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}
