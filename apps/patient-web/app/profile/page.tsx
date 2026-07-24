"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@medpass/localization";
import { Banner, Button, Card, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { ProfileDetailsSettings } from "../../components/ProfileDetailsSettings";
import { ReminderSettings } from "../../components/ReminderSettings";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { cancelClaimInvite, inviteToClaimProfile } from "../../lib/profiles";
import { useSession } from "../../lib/session";

const CLAIM_EXPIRY_OPTIONS = [
  { hours: undefined, key: "caregiver.expiry.none" },
  { hours: 24 * 30, key: "caregiver.expiry.30d" },
  { hours: 24 * 90, key: "caregiver.expiry.90d" },
  { hours: 24 * 365, key: "caregiver.expiry.1y" },
] as const;

/** The "invite them to claim" section (docs/07 screen 5's secondary action,
 * reachable any time, not just at creation) — visible only when the active
 * profile is one the caregiver directly owns and unclaimed. */
function ClaimInviteSection() {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [phone, setPhone] = useState("+91");
  const [expiryHours, setExpiryHours] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      await inviteToClaimProfile(phone, expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() : undefined);
      await refresh();
    } catch {
      setError(t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await cancelClaimInvite();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <strong>{t("caregiver.claim_invite_section_title")}</strong>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("caregiver.claim_invite_section_intro")}</span>
      <div style={{ marginTop: "var(--space-sm)" }}>
        <TextInput
          label={t("caregiver.phone_label")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap", margin: "var(--space-sm) 0" }}>
        {CLAIM_EXPIRY_OPTIONS.map((opt) => (
          <Button key={opt.key} variant={expiryHours === opt.hours ? "primary" : "secondary"} onClick={() => setExpiryHours(opt.hours)}>
            {t(opt.key as never)}
          </Button>
        ))}
      </div>
      <Button fullWidth disabled={busy || phone.replace(/\D/g, "").length < 8} onClick={() => void send()}>
        {t("caregiver.send_invite")}
      </Button>
    </Card>
  );
}

function ClaimInvitePendingSection() {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      await cancelClaimInvite();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone="info">
      <strong>{t("caregiver.claim_invite_pending_title")}</strong>
      <div style={{ marginTop: "var(--space-sm)" }}>
        <Button variant="danger" disabled={busy} onClick={() => void cancel()}>
          {t("caregiver.claim_invite_cancel")}
        </Button>
      </div>
    </Card>
  );
}

interface SessionItem {
  id: string;
  device: { kind: string; label: string | null };
  createdAt: string;
  current: boolean;
}

/** Screens 2/35 + profile hub (docs/07): language, profiles, sessions, sign out. */
export default function ProfilePage() {
  const { t, locale, setLocale } = useI18n();
  const { profiles, activeProfileId, signOut } = useSession();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  useEffect(() => {
    api
      .get<{ items: SessionItem[] }>("/auth/sessions")
      .then((res) => setSessions(res.items))
      .catch(() => setSessions([]));
  }, []);

  async function revoke(id: string) {
    await api.delete(`/auth/sessions/${id}`);
    setSessions((s) => s.filter((x) => x.id !== id));
  }

  return (
    <AppShell>
      <PageHeader title={t("profile.title")} />

      <ProfileDetailsSettings />

      <Link href="/allergies">
        <Card>
          <strong>{t("profile.allergies")}</strong>
        </Card>
      </Link>

      {activeProfile?.relationship !== "caregiver" ? (
        <Link href="/caregivers">
          <Card>
            <strong>{t("profile.caregivers")}</strong>
          </Card>
        </Link>
      ) : null}

      <Link href="/profile/dependents/new">
        <Card>
          <strong>{t("profile.add_dependent")}</strong>
        </Card>
      </Link>

      {activeProfile?.relationship === "dependent" ? (
        activeProfile.claimInvited ? <ClaimInvitePendingSection /> : <ClaimInviteSection />
      ) : null}

      <ReminderSettings />

      <SectionTitle>{t("profile.language")}</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--size-touch-gap)" }}>
        {SUPPORTED_LOCALES.map((l) => (
          <Button key={l} variant={l === locale ? "primary" : "secondary"} onClick={() => setLocale(l)}>
            {LOCALE_NAMES[l]}
          </Button>
        ))}
      </div>

      <SectionTitle>{t("profile.sessions")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {sessions.map((s) => (
          <Card key={s.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
              <div>
                <strong>{s.device.label ?? s.device.kind}</strong>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {new Date(s.createdAt).toLocaleString()}
                  {s.current ? " · ✓" : ""}
                </div>
              </div>
              {!s.current ? (
                <Button variant="danger" onClick={() => void revoke(s.id)}>
                  ✕
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-xl)" }}>
        <Button variant="secondary" fullWidth onClick={() => void signOut()}>
          {t("auth.sign_out")}
        </Button>
      </div>
    </AppShell>
  );
}
