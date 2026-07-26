"use client";
import Link from "next/link";
import { Banner, Button, Card, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { useI18n } from "../../../lib/i18n";
import { resolveConflict, useConflicts } from "../../../lib/conflicts";

/**
 * "Needs your review" (docs/15): a queued medicine edit that couldn't be
 * (fully) applied because the medicine changed elsewhere first. Every field
 * that *could* be safely merged already was, server-side — this only ever
 * lists what's left: either the whole edit (a pure dose/frequency change,
 * which never auto-merges — docs/15 clinical-safety rule) or just the
 * dose/frequency portion of a mixed edit.
 */
export default function SyncConflictsPage() {
  const { t } = useI18n();
  const { items, reload } = useConflicts();

  async function keep(clientMutationId: string) {
    await resolveConflict(clientMutationId);
    await reload();
  }

  if (!items) {
    return (
      <AppShell>
        <PillSpinner label={t("common.loading")} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("sync.conflicts_title")} />

      {items.length === 0 ? (
        <Banner tone="info">{t("sync.conflicts_empty")}</Banner>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((c) => {
            const serverState = c.serverState as { id?: string; enteredName?: string } | undefined;
            const name = serverState?.enteredName ?? t("sync.conflicts_unknown_medicine");
            return (
              <Card key={c.clientMutationId} tone="warning">
                <strong>{name}</strong>
                <span style={{ fontSize: "var(--font-small)" }}>
                  {c.unmergedFields?.includes("instruction")
                    ? t("sync.conflicts_instruction_note")
                    : t("sync.conflicts_generic_note")}
                </span>
                <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-xs)" }}>
                  {serverState?.id ? (
                    <Link href={`/medicines/${serverState.id}/edit`} style={{ flex: 1 }}>
                      <Button variant="secondary" fullWidth>
                        {t("sync.conflicts_edit_again")}
                      </Button>
                    </Link>
                  ) : null}
                  <div style={{ flex: 1 }}>
                    <Button variant="secondary" fullWidth onClick={() => void keep(c.clientMutationId)}>
                      {t("sync.conflicts_keep_current")}
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
