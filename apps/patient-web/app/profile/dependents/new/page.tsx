"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, ChoiceGrid, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { useI18n } from "../../../../lib/i18n";
import { createDependent, inviteToClaimProfile } from "../../../../lib/profiles";
import { useSession } from "../../../../lib/session";

type Relationship = "parent" | "child" | "spouse" | "sibling" | "other";
const RELATIONSHIPS: Relationship[] = ["parent", "child", "spouse", "sibling", "other"];
const EXPIRY_OPTIONS = [
  { hours: undefined, key: "caregiver.expiry.none" },
  { hours: 24 * 30, key: "caregiver.expiry.30d" },
  { hours: 24 * 90, key: "caregiver.expiry.90d" },
  { hours: 24 * 365, key: "caregiver.expiry.1y" },
] as const;

/**
 * Screen 5: caregiver creates a managed profile (docs/07). Primary action
 * creates the profile; a second step offers the documented secondary
 * action — inviting the dependent to claim it themselves — with an easy
 * skip, since a phone number isn't always in hand at creation time (a
 * toddler has no one to invite yet; an adult child setting up a reachable
 * parent's profile does). Inviting later from the dependent's own Profile
 * page (once viewing it via the switcher) covers the "years later" case
 * this step doesn't.
 */
export default function AddDependentPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { refresh, selectProfile } = useSession();

  const [name, setName] = useState("");
  const [year, setYear] = useState("");
  const [relationship, setRelationship] = useState<Relationship | undefined>();
  const [guardianAttestation, setGuardianAttestation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Children V1: a child dependent (relationship "child", or a birth year that
  // indicates under 18) requires an explicit parent/lawful-guardian attestation
  // before it can be created. Mirrors the server rule (profiles.controller.ts).
  const currentYear = new Date().getFullYear();
  const yearNum = Number(year);
  const yearIsMinor = /^\d{4}$/.test(year) && currentYear - yearNum < 18;
  const needsGuardian = relationship === "child" || yearIsMinor;

  const [createdProfileId, setCreatedProfileId] = useState<string | undefined>();
  const [phone, setPhone] = useState("+91");
  const [expiryHours, setExpiryHours] = useState<number | undefined>(undefined);

  async function create() {
    if (!relationship) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await createDependent({
        displayName: name,
        ...(year ? { yearOfBirth: Number(year) } : {}),
        preferredLocale: locale,
        relationship,
        ...(needsGuardian ? { guardianAttestation } : {}),
      });
      await refresh();
      setCreatedProfileId(res.id);
      // Switch into the new dependent's profile now, not just on finish() —
      // the invite call below is X-Profile-Id-scoped ("current" profile),
      // so it must already be targeting the dependent, not the caregiver.
      selectProfile(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!createdProfileId) return;
    selectProfile(createdProfileId);
    router.replace("/");
  }

  async function sendInviteAndFinish() {
    if (!createdProfileId) return;
    setBusy(true);
    setError(undefined);
    try {
      await inviteToClaimProfile(
        phone,
        expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() : undefined,
      );
      await refresh();
      await finish();
    } catch {
      setError(t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  if (createdProfileId) {
    return (
      <AppShell>
        <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("caregiver.dependent_invite_title")}</h1>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <span style={{ color: "var(--color-text-muted)" }}>{t("caregiver.dependent_invite_intro")}</span>

        <TextInput
          label={t("caregiver.phone_label")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <SectionTitle>{t("caregiver.expiry_label")}</SectionTitle>
        <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
          {EXPIRY_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              variant={expiryHours === opt.hours ? "primary" : "secondary"}
              onClick={() => setExpiryHours(opt.hours)}
            >
              {t(opt.key as never)}
            </Button>
          ))}
        </div>

        <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <Button fullWidth loading={busy} disabled={busy || phone.replace(/\D/g, "").length < 8} onClick={() => void sendInviteAndFinish()}>
            {t("caregiver.send_invite")}
          </Button>
          <Button variant="ghost" fullWidth disabled={busy} onClick={() => void finish()}>
            {t("caregiver.dependent_invite_skip")}
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("caregiver.dependent_add_title")}</h1>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <span style={{ color: "var(--color-text-muted)" }}>{t("caregiver.dependent_intro")}</span>

      <TextInput
        label={t("caregiver.dependent_name_label")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
      />
      <TextInput
        label={t("caregiver.dependent_year_label")}
        type="number"
        inputMode="numeric"
        value={year}
        onChange={(e) => setYear(e.target.value)}
      />

      <SectionTitle>{t("caregiver.dependent_relationship_label")}</SectionTitle>
      <ChoiceGrid
        label={t("caregiver.dependent_relationship_label")}
        columns={3}
        choices={RELATIONSHIPS.map((r) => ({ value: r, label: t(`caregiver.relationship.${r}` as never) }))}
        value={relationship}
        onChange={setRelationship}
      />

      {needsGuardian ? (
        <label style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start", marginTop: "var(--space-md)" }}>
          <input
            type="checkbox"
            checked={guardianAttestation}
            onChange={(e) => setGuardianAttestation(e.target.checked)}
            style={{ width: 22, height: 22, marginTop: 2, flex: "none" }}
          />
          <span>{t("caregiver.guardian_attestation")}</span>
        </label>
      ) : null}

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Button
          fullWidth
          loading={busy}
          disabled={busy || name.trim().length === 0 || !relationship || (needsGuardian && !guardianAttestation)}
          onClick={() => void create()}
        >
          {t("caregiver.dependent_create")}
        </Button>
      </div>
    </AppShell>
  );
}
