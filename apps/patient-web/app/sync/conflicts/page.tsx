"use client";
import Link from "next/link";
import type { DocumentUploadIntentPayload, StoredConflict } from "@medpass/offline-sync";
import { Button, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { resolveConflict, useConflicts, usePendingSync, type PendingItem } from "../../../lib/conflicts";
import { useI18n } from "../../../lib/i18n";
import { isHubConcept } from "../../../lib/observations";
import { formatPatientDateTime, useActiveTimezone } from "../../../lib/patient-time";

/**
 * "Needs your review" (docs/15) plus "waiting to send" (docs_v2/05 §14).
 *
 * Conflicts: a queued medicine edit that couldn't be (fully) applied
 * because the medicine changed elsewhere first — every field that *could*
 * be safely merged already was, server-side; a reading that was deleted on
 * another device before this phone's copy reached the server; a document
 * capture the server refused or that was removed before it finished
 * sending. Pending: everything still queued, in capture order, with live
 * page-by-page progress for a document being sent right now.
 */
export default function SyncConflictsPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items, reload } = useConflicts();
  const { items: pending } = usePendingSync();

  async function keep(clientMutationId: string) {
    await resolveConflict(clientMutationId);
    await reload();
  }

  if (!items || !pending) {
    return (
      <AppShell>
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  function pendingLabel(item: PendingItem): string {
    const { mutation, progress } = item;
    if (mutation.entity === "observation") {
      const concept = (mutation.payload as { concept?: string } | undefined)?.concept;
      const name = isHubConcept(concept) ? t(`measure.concept.${concept}` as never) : t("measure.title");
      return t("sync.pending_measurement", { name });
    }
    if (mutation.entity === "document_upload_intent") {
      const total = (mutation.payload as DocumentUploadIntentPayload).pages.length;
      if (progress?.status === "uploading") {
        return t("sync.pending_document_progress", { done: Math.min(total, progress.completedPages.length + 1), total });
      }
      return t("sync.pending_document", { n: total });
    }
    if (mutation.entity === "dose_event") return t("sync.pending_dose");
    return t("sync.pending_medicine");
  }

  function conflictView(c: StoredConflict): { title: string; note: string; addAgainHref?: string; editHref?: string } {
    if (c.entity === "observation") {
      const state = c.serverState as { concept?: string } | undefined;
      const concept = state?.concept;
      const name = isHubConcept(concept) ? t(`measure.concept.${concept}` as never) : t("measure.title");
      return {
        title: t("sync.pending_measurement", { name }),
        note: c.kind === "deleted" ? t("sync.conflicts_observation_deleted") : t("sync.conflicts_observation_invalid"),
        addAgainHref: isHubConcept(concept) ? `/measurements/${concept}` : "/measurements",
      };
    }
    if (c.entity === "document_upload_intent") {
      return {
        title: t("home.tile.documents"),
        note: c.kind === "deleted" ? t("sync.conflicts_document_deleted") : t("sync.conflicts_document_failed"),
        addAgainHref: "/documents/new",
      };
    }
    const serverState = c.serverState as { id?: string; enteredName?: string } | undefined;
    return {
      title: serverState?.enteredName ?? t("sync.conflicts_unknown_medicine"),
      note: c.unmergedFields?.includes("instruction") ? t("sync.conflicts_instruction_note") : t("sync.conflicts_generic_note"),
      editHref: serverState?.id ? `/medicines/${serverState.id}/edit` : undefined,
    };
  }

  return (
    <AppShell>
      <PageHeader title={t("sync.conflicts_title")} readAloud={[{ audio: "screen.sync_conflicts" }]} />

      {pending.length > 0 ? (
        <>
          <SectionTitle>{t("sync.pending_title")}</SectionTitle>
          <p style={{ color: "var(--color-text-muted)", margin: "0 0 var(--space-sm)", fontSize: "var(--font-small)" }}>{t("sync.pending_body")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
            {pending.map((item) => (
              <Card key={item.mutation.clientMutationId} data-testid="pending-mutation" data-entity={item.mutation.entity}>
                <strong>{pendingLabel(item)}</strong>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t("sync.pending_captured_at", { time: formatPatientDateTime(item.mutation.capturedAt, timezone) })}
                </span>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {items.length === 0 ? (
        pending.length === 0 ? (
          <EmptyState glyph="check" titleKey="sync.conflicts_empty_title" bodyKey="sync.conflicts_empty_body" audioId="empty.sync_conflicts" />
        ) : null
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((c) => {
            const view = conflictView(c);
            return (
              <Card key={c.clientMutationId} tone="warning" data-testid="sync-conflict" data-entity={c.entity}>
                <strong>{view.title}</strong>
                <span style={{ fontSize: "var(--font-small)" }}>{view.note}</span>
                <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-xs)" }}>
                  {view.editHref ? (
                    <Link href={view.editHref} style={{ flex: 1 }}>
                      <Button variant="secondary" fullWidth>
                        {t("sync.conflicts_edit_again")}
                      </Button>
                    </Link>
                  ) : null}
                  {view.addAgainHref ? (
                    <Link href={view.addAgainHref} style={{ flex: 1 }}>
                      <Button variant="secondary" fullWidth>
                        {t("sync.conflicts_add_again")}
                      </Button>
                    </Link>
                  ) : null}
                  <div style={{ flex: 1 }}>
                    <Button variant="secondary" fullWidth onClick={() => void keep(c.clientMutationId)}>
                      {view.editHref ? t("sync.conflicts_keep_current") : t("sync.conflicts_dismiss")}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
