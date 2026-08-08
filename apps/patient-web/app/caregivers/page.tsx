"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CaregiverAccessEventDto } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { fetchCaregiverAccessLog, isCaregiverActive, revokeCaregiver, useCaregivers } from "../../lib/caregivers";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";

/** Screen 6 (list part): existing caregivers, their scopes, access history, revoke. */
export default function CaregiversPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { profiles, activeProfileId } = useSession();
  const { items, error, reload } = useCaregivers();
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [accessLog, setAccessLog] = useState<CaregiverAccessEventDto[]>([]);
  const [busyId, setBusyId] = useState<string | undefined>();

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  useEffect(() => {
    // manage_caregivers is patient-only — no scope ever grants a caregiver
    // this screen, so redirect rather than let the list 403 confusingly.
    if (activeProfile && activeProfile.relationship === "caregiver") router.replace("/profile");
  }, [activeProfile, router]);

  async function toggleLog(id: string) {
    if (expandedId === id) {
      setExpandedId(undefined);
      return;
    }
    const log = await fetchCaregiverAccessLog(id);
    setAccessLog(log);
    setExpandedId(id);
  }

  async function revoke(id: string, wasActive: boolean) {
    if (wasActive && !window.confirm(t("caregiver.revoke_confirm"))) return;
    setBusyId(id);
    try {
      await revokeCaregiver(id);
      await reload();
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("caregiver.list_title")} readAloud={[{ audio: "screen.caregivers" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      <Link href="/caregivers/new">
        <Button fullWidth>{t("caregiver.invite_button")}</Button>
      </Link>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState
          glyph="people"
          titleKey="caregiver.list_empty_title"
          bodyKey="caregiver.list_empty_body"
          audioId="empty.caregivers"
          cta={{ labelKey: "caregiver.invite_button", href: "/caregivers/new" }}
        />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((c) => {
            const active = isCaregiverActive(c);
            // "invited" is its own state, checked first — it must never fall
            // through to the time-based expiry check below, which only
            // makes sense once a relationship has actually gone "active".
            const statusKey = c.status === "invited" ? "invited" : active ? "active" : "expired";
            return (
              <Card key={c.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{c.label || t(`caregiver.relationship.${c.relationship}` as never)}</strong>
                    {c.label ? (
                      <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                        {t(`caregiver.relationship.${c.relationship}` as never)}
                      </div>
                    ) : null}
                  </div>
                  <Chip tone={statusKey === "active" ? "success" : statusKey === "invited" ? "default" : "danger"}>
                    {t(`caregiver.status.${statusKey}` as never)}
                  </Chip>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", margin: "var(--space-xs) 0" }}>
                  {c.scopes.map((s) => (
                    <Chip key={s}>{t(`caregiver.scope.${s}` as never)}</Chip>
                  ))}
                </div>
                <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
                  {c.expiresAt ? t("caregiver.expires", { date: new Date(c.expiresAt).toLocaleDateString() }) : t("caregiver.no_expiry")}
                </span>
                <button
                  type="button"
                  aria-expanded={expandedId === c.id}
                  aria-controls={`access-log-${c.id}`}
                  onClick={() => void toggleLog(c.id)}
                  style={{ background: "none", border: "none", color: "var(--color-info)", textAlign: "start", padding: 0, cursor: "pointer", display: "block", marginTop: "var(--space-xs)" }}
                >
                  {t("caregiver.access_log_toggle")}
                </button>
                {expandedId === c.id ? (
                  <div id={`access-log-${c.id}`} style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
                    {accessLog.length === 0
                      ? t("caregiver.access_log_empty")
                      : accessLog.map((a, i) => (
                          <div key={i}>{t("caregiver.access_event", { time: new Date(a.accessedAt).toLocaleString() })}</div>
                        ))}
                  </div>
                ) : null}
                <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
                  {active ? (
                    <Link href={`/caregivers/${c.id}/edit`} style={{ flex: 1 }}>
                      <Button variant="secondary" fullWidth>
                        {t("caregiver.edit_scopes")}
                      </Button>
                    </Link>
                  ) : null}
                  <Button
                    variant="danger"
                    loading={busyId === c.id}
                    disabled={busyId === c.id}
                    onClick={() => void revoke(c.id, active)}
                    style={{ flex: 1 }}
                  >
                    {c.status === "invited" ? t("caregiver.cancel_invite") : t("caregiver.revoke")}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </AppShell>
  );
}
