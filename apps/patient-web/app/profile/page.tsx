"use client";
import { useEffect, useState } from "react";
import { LOCALE_NAMES, SUPPORTED_LOCALES } from "@medpass/localization";
import { Banner, Button, Card, Chip, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { ProfileLink } from "../../components/ProfileLink";
import { ProfileDetailsSettings } from "../../components/ProfileDetailsSettings";
import { ReminderSettings } from "../../components/ReminderSettings";
import { TimezoneSettings } from "../../components/TimezoneSettings";
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
      <Button fullWidth loading={busy} disabled={busy || phone.replace(/\D/g, "").length < 8} onClick={() => void send()}>
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
        <Button variant="danger" loading={busy} disabled={busy} onClick={() => void cancel()}>
          {t("caregiver.claim_invite_cancel")}
        </Button>
      </div>
    </Card>
  );
}

interface DeviceItem {
  id: string;
  kind: string;
  label: string | null;
  /** Docs/24 ADR-14: can log back in with just a phone number, no OTP. */
  trusted: boolean;
  hasLiveSession: boolean;
  isCurrent: boolean;
  lastSeenAt: string;
  createdAt: string;
}

/** Screens 2/35 + profile hub (docs/07): language, profiles, sessions, sign out. */
export default function ProfilePage() {
  const { t, locale, setLocale } = useI18n();
  const { profiles, activeProfileId, signOut } = useSession();
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  useEffect(() => {
    api
      .get<{ items: DeviceItem[] }>("/auth/devices")
      .then((res) => setDevices(res.items))
      .catch(() => setDevices([]));
  }, []);

  async function revoke(id: string) {
    await api.delete(`/auth/devices/${id}`);
    setDevices((d) => d.filter((x) => x.id !== id));
  }

  return (
    <AppShell>
      <PageHeader title={t("profile.title")} readAloud={[{ audio: "screen.profile" }]} />

      <ProfileDetailsSettings />

      <TimezoneSettings />

      {/* The records hub, grouped so ten destinations read as two short
          menus instead of one undifferentiated wall of cards. Order is
          unchanged from the ungrouped layout (docs/06 IA). */}
      <SectionTitle>{t("profile.section_records")}</SectionTitle>
      <ProfileLink href="/health" glyph="timeline" label={t("profile.health_timeline")} />
      <ProfileLink href="/health/visits" glyph="hospital" label={t("profile.visits")} />
      <ProfileLink href="/blood-sugar" glyph="drop" label={t("profile.blood_sugar")} />
      <ProfileLink href="/blood-pressure" glyph="heart" label={t("profile.blood_pressure")} />
      <ProfileLink href="/body-weight" glyph="scale" label={t("profile.body_weight")} />
      <ProfileLink href="/prescriptions" glyph="prescription" label={t("profile.prescriptions")} />
      <ProfileLink href="/reports" glyph="report" label={t("profile.reports")} />
      <ProfileLink href="/doctors" glyph="people" label={t("profile.doctors")} />

      {/* docs/06 sitemap: Help lives under Profile (screen 41). */}
      <ProfileLink href="/help" glyph="question" label={t("help.open")} />

      {/* Phase 1 clinical profile (docs_v2/06 P1-4): the facts a new doctor
          asks for first, each its own typing-light screen. */}
      <SectionTitle>{t("profile.section_health")}</SectionTitle>
      <ProfileLink href="/profile/health-details" glyph="pulse" label={t("profile.health_details")} />
      <ProfileLink href="/conditions" glyph="pulse" label={t("profile.conditions")} />
      <ProfileLink href="/allergies" glyph="shield" label={t("profile.allergies")} />
      <ProfileLink href="/immunizations" glyph="syringe" label={t("profile.immunizations")} />
      <ProfileLink href="/procedures" glyph="cross" label={t("profile.procedures")} />
      <ProfileLink href="/family-history" glyph="family" label={t("profile.family_history")} />
      <ProfileLink href="/organizations" glyph="hospital" label={t("profile.organizations")} />

      <SectionTitle>{t("profile.section_care")}</SectionTitle>
      {/* V2 Phase 6 (docs_v2/06 P6-3): the two screens that span the family —
          everyone this account looks after, and what those people changed. */}
      <ProfileLink href="/family" glyph="family" label={t("household.title")} />
      <ProfileLink href="/activity" glyph="timeline" label={t("activity.title")} />
      {activeProfile?.relationship !== "caregiver" ? (
        <ProfileLink href="/caregivers" glyph="people" label={t("profile.caregivers")} />
      ) : null}
      <ProfileLink href="/profile/dependents/new" glyph="people" label={t("profile.add_dependent")} />

      {activeProfile?.relationship === "dependent" ? (
        activeProfile.claimInvited ? <ClaimInvitePendingSection /> : <ClaimInviteSection />
      ) : null}

      <ReminderSettings />

      {/* Per-kind channel and frequency (docs_v2/06 P6-4) — its own screen:
          fourteen kinds do not belong inside the push/quiet-hours card. */}
      <ProfileLink href="/profile/notifications" glyph="bell" label={t("notify.title")} />

      <SectionTitle>{t("profile.language")}</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--size-touch-gap)" }}>
        {SUPPORTED_LOCALES.map((l) => (
          <Button key={l} variant={l === locale ? "primary" : "secondary"} onClick={() => setLocale(l)}>
            {LOCALE_NAMES[l]}
          </Button>
        ))}
      </div>

      <SectionTitle>{t("profile.sessions")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {devices.map((d) => (
          <Card key={d.id}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <strong>{d.label ?? d.kind}</strong>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {new Date(d.lastSeenAt).toLocaleString()}
                </div>
                <div style={{ display: "flex", gap: "var(--space-xs)", marginTop: "var(--space-xs)", flexWrap: "wrap" }}>
                  {d.isCurrent ? <Chip tone="success">{t("profile.device_current")}</Chip> : null}
                  {d.trusted ? <Chip tone="success">{t("profile.device_trusted")}</Chip> : null}
                  {!d.hasLiveSession ? <Chip>{t("profile.device_no_live_session")}</Chip> : null}
                </div>
              </div>
              {!d.isCurrent ? (
                <Button variant="danger" onClick={() => void revoke(d.id)}>
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
