"use client";
import { useState } from "react";
import Link from "next/link";
import type { ShareAccessEventDto } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { fetchAccessLog, revokeShare, useShares } from "../../lib/sharing";

/** Screen 29 (list part): active shares with access history and revoke. */
export default function SharesPage() {
  const { t } = useI18n();
  const { items, error, reload } = useShares();
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [accessLog, setAccessLog] = useState<ShareAccessEventDto[]>([]);
  const [busyId, setBusyId] = useState<string | undefined>();

  async function toggleLog(id: string) {
    if (expandedId === id) {
      setExpandedId(undefined);
      return;
    }
    const log = await fetchAccessLog(id);
    setAccessLog(log);
    setExpandedId(id);
  }

  async function revoke(id: string) {
    setBusyId(id);
    try {
      await revokeShare(id);
      await reload();
    } finally {
      setBusyId(undefined);
    }
  }

  const isActive = (s: { expiresAt: string; revokedAt: string | null }) =>
    !s.revokedAt && new Date(s.expiresAt) > new Date();

  return (
    <AppShell>
      <PageHeader title={t("share.view_all")} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      <Link href="/share/new">
        <Button fullWidth>{t("share.new_title")}</Button>
      </Link>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("share.empty")}</span>
        </Card>
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((s) => {
            const active = isActive(s);
            return (
              <Card key={s.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{new Date(s.createdAt).toLocaleString()}</strong>
                  <Chip tone={active ? "success" : "default"}>
                    {active ? t("share.status.active") : s.revokedAt ? t("share.status.revoked") : t("share.status.expired")}
                  </Chip>
                </div>
                <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
                  {t("share.expires", { time: new Date(s.expiresAt).toLocaleString() })}
                </span>
                <button
                  type="button"
                  aria-expanded={expandedId === s.id}
                  aria-controls={`access-log-${s.id}`}
                  onClick={() => void toggleLog(s.id)}
                  style={{ background: "none", border: "none", color: "var(--color-info)", textAlign: "start", padding: 0, cursor: "pointer" }}
                >
                  {t("share.access_count", { count: s.accessCount })}
                </button>
                {expandedId === s.id ? (
                  <div id={`access-log-${s.id}`} style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
                    {accessLog.length === 0
                      ? t("share.no_accesses")
                      : accessLog.map((a, i) => (
                          <div key={i}>
                            {new Date(a.accessedAt).toLocaleString()} — {t(`share.access_result.${a.result}` as never)}
                          </div>
                        ))}
                  </div>
                ) : null}
                {active ? (
                  <Button variant="danger" loading={busyId === s.id} disabled={busyId === s.id} onClick={() => void revoke(s.id)}>
                    {t("share.revoke")}
                  </Button>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}
    </AppShell>
  );
}
