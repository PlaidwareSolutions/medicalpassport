"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Card, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { useI18n } from "../../../lib/i18n";
import { claimProfile, useClaimInvitations } from "../../../lib/profiles";
import { useSession } from "../../../lib/session";

/**
 * Accepts an invitation to claim a profile someone else created (docs/07
 * screen 5's reverse direction) — mirrors caregivers/invitations/page.tsx.
 */
export default function ClaimInvitationsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const session = useSession();
  const { items, error, reload } = useClaimInvitations();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [claimError, setClaimError] = useState<string | undefined>();

  async function claim(profileId: string) {
    setBusyId(profileId);
    setClaimError(undefined);
    try {
      const res = await claimProfile(profileId);
      await session.refresh();
      session.selectProfile(res.id);
      router.replace("/");
    } catch {
      setClaimError(t("caregiver.claim_error"));
      await reload();
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("caregiver.claim_invitations_title")} readAloud={[{ audio: "screen.claim_invitations" }]} />
      {error || claimError ? <Banner tone="danger">{claimError ?? t("common.error_generic")}</Banner> : null}

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState
          glyph="people"
          titleKey="caregiver.claim_invitations_empty_title"
          bodyKey="caregiver.claim_invitations_empty_body"
          audioId="empty.claim_invitations"
        />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((i) => (
            <Card key={i.profileId}>
              <strong>{i.displayName}</strong>
              {i.yearOfBirth ? (
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{i.yearOfBirth}</span>
              ) : null}
              <Button fullWidth loading={busyId === i.profileId} disabled={busyId === i.profileId} onClick={() => void claim(i.profileId)}>
                {t("caregiver.claim_action")}
              </Button>
            </Card>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
