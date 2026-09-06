"use client";
import { useState } from "react";
import Link from "next/link";
import type { ShareAccessEventDto } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { ScopeNotice } from "../../components/ScopeGate";
import { useI18n } from "../../lib/i18n";
import { useProfileAccess } from "../../lib/scopes";
import { SHARE_SECTIONS, fetchAccessLog, revokeShare, useShares, type ShareListItem } from "../../lib/sharing";

/** Screen 29 (list part): active shares with access history and revoke. */
export default function SharesPage() {
  const { t } = useI18n();
  const access = useProfileAccess();
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

  if (access.ready && !access.can("share_records")) {
    return (
      <AppShell>
        <PageHeader title={t("share.view_all")} />
        <ScopeNotice action="share_records" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("share.view_all")} readAloud={[{ audio: "screen.share" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      <Link href="/share/new">
        <Button fullWidth>{t("share.new_title")}</Button>
      </Link>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState
          glyph="share"
          titleKey="share.empty_title"
          bodyKey="share.empty_body"
          audioId="empty.share"
          cta={{ labelKey: "share.create", href: "/share/new" }}
        />
      ) : null}

      {items && items.length > 0 ? (
        <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>{t("share.frozen_note")}</span>
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
                <SharedSections share={s} />
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

/**
 * What one existing link actually shows. Read from the link's own frozen
 * section map, never recomputed from today's defaults — that frozen map is
 * the guarantee an old link never widens when the app learns new sections
 * (docs_v2/06 P7 exit gate), and the only way a patient can see the
 * guarantee held is if the screen reads the same thing the server does.
 */
function SharedSections({ share }: { share: ShareListItem }) {
  const { t } = useI18n();
  const sections = (share.sections ?? {}) as Record<string, boolean>;
  const full = sections.full_passport === true;
  const names = full
    ? [t("share.section.full_passport")]
    : SHARE_SECTIONS.filter((key) => sections[key]).map((key) => t(`share.section.${key}` as never));

  return (
    <div style={{ fontSize: "var(--font-small)" }}>
      {share.audience && share.audience !== "unspecified" ? (
        <div style={{ marginBottom: "var(--space-xs)" }}>
          <Chip>{t(`share.audience.${share.audience}` as never)}</Chip>
        </div>
      ) : null}
      <span style={{ color: "var(--color-text-muted)" }}>
        {names.length === 0 ? t("share.shows_nothing") : t("share.shows", { sections: names.join(", ") })}
      </span>
    </div>
  );
}
