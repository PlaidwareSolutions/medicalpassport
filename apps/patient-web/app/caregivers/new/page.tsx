"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CAREGIVER_SCOPES, type CaregiverScope } from "@medpass/domain";
import type { CaregiverRelationshipKind } from "@medpass/api-client";
import { Banner, Button, Card, ChoiceGrid, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { useI18n } from "../../../lib/i18n";
import { inviteCaregiver } from "../../../lib/caregivers";
import { useSession } from "../../../lib/session";

const RELATIONSHIPS: CaregiverRelationshipKind[] = ["parent", "child", "spouse", "sibling", "other"];
const EXPIRY_OPTIONS = [
  { hours: undefined, key: "caregiver.expiry.none" },
  { hours: 24 * 30, key: "caregiver.expiry.30d" },
  { hours: 24 * 90, key: "caregiver.expiry.90d" },
  { hours: 24 * 365, key: "caregiver.expiry.1y" },
] as const;

/** Screen 6 (invite part): phone + granular scopes + optional expiry. */
export default function InviteCaregiverPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { profiles, activeProfileId } = useSession();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  useEffect(() => {
    if (activeProfile && activeProfile.relationship === "caregiver") router.replace("/profile");
  }, [activeProfile, router]);

  const [phone, setPhone] = useState("+91");
  const [label, setLabel] = useState("");
  const [relationship, setRelationship] = useState<CaregiverRelationshipKind | undefined>();
  const [scopes, setScopes] = useState<Record<CaregiverScope, boolean>>(
    Object.fromEntries(CAREGIVER_SCOPES.map((s) => [s, false])) as Record<CaregiverScope, boolean>,
  );
  const [expiryHours, setExpiryHours] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);

  const selectedScopes = CAREGIVER_SCOPES.filter((s) => scopes[s]);
  const ready = phone.replace(/\D/g, "").length >= 8 && !!relationship && selectedScopes.length > 0;

  async function send() {
    if (!relationship) return;
    setBusy(true);
    setError(undefined);
    try {
      await inviteCaregiver({
        phone,
        scopes: selectedScopes,
        relationship,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(expiryHours ? { expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString() } : {}),
      });
      setSent(true);
    } catch {
      setError(t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AppShell>
        <PageHeader title={t("caregiver.invite_sent_title")} />
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("caregiver.invite_sent_body")}</span>
        </Card>
        <Link href="/caregivers">
          <Button fullWidth>{t("caregiver.back_to_list")}</Button>
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title={t("caregiver.invite_title")} />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <TextInput
        label={t("caregiver.phone_label")}
        help={t("caregiver.phone_help")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <TextInput
        label={t("caregiver.label_field")}
        help={t("caregiver.label_help")}
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />

      <SectionTitle>{t("caregiver.relationship_label")}</SectionTitle>
      <ChoiceGrid
        label={t("caregiver.relationship_label")}
        columns={3}
        choices={RELATIONSHIPS.map((r) => ({ value: r, label: t(`caregiver.relationship.${r}` as never) }))}
        value={relationship}
        onChange={setRelationship}
      />

      <SectionTitle>{t("caregiver.scopes_label")}</SectionTitle>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("caregiver.scopes_help")}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
        {CAREGIVER_SCOPES.map((scope) => (
          <label
            key={scope}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-sm)",
              minHeight: "var(--size-touch)",
              padding: "var(--space-sm)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={scopes[scope]}
              onChange={(e) => setScopes((s) => ({ ...s, [scope]: e.target.checked }))}
              style={{ width: 24, height: 24 }}
            />
            {t(`caregiver.scope.${scope}` as never)}
          </label>
        ))}
      </div>
      {!ready && selectedScopes.length === 0 ? (
        <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
          {t("caregiver.scopes_required_error")}
        </span>
      ) : null}

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

      <div style={{ marginTop: "var(--space-lg)" }}>
        <Button fullWidth loading={busy} disabled={busy || !ready} onClick={() => void send()}>
          {t("caregiver.send_invite")}
        </Button>
      </div>
    </AppShell>
  );
}
