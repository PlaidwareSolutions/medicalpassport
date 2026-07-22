"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Card, Chip } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { acceptInvitation, useCaregiverInvitations } from "../../../lib/caregivers";
import { useI18n } from "../../../lib/i18n";
import { useSession } from "../../../lib/session";

/**
 * No numbered doc screen for this — needed because informed consent means
 * showing the offered scopes before accepting (docs/23 E3.2), which is more
 * than a banner action can carry.
 */
export default function CaregiverInvitationsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const session = useSession();
  const { items, error, reload } = useCaregiverInvitations();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [acceptError, setAcceptError] = useState<string | undefined>();

  async function accept(id: string) {
    setBusyId(id);
    setAcceptError(undefined);
    try {
      const res = await acceptInvitation(id);
      await session.refresh();
      session.selectProfile(res.patientProfileId);
      router.replace("/");
    } catch {
      setAcceptError(t("caregiver.accept_error"));
      await reload();
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("caregiver.invitations_title")}</h1>
      {error || acceptError ? <Banner tone="danger">{acceptError ?? t("common.error_generic")}</Banner> : null}

      {items && items.length === 0 ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("caregiver.invitations_empty")}</span>
        </Card>
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((i) => (
            <Card key={i.id}>
              <strong>{t("caregiver.invitation_from", { name: i.patientDisplayName })}</strong>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {t(`caregiver.relationship.${i.relationship}` as never)}
              </span>
              <div style={{ margin: "var(--space-sm) 0" }}>
                <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
                  {t("caregiver.invitation_scopes_preview")}
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-xs)", marginTop: "var(--space-xs)" }}>
                  {i.scopes.map((s) => (
                    <Chip key={s}>{t(`caregiver.scope.${s}` as never)}</Chip>
                  ))}
                </div>
              </div>
              <Button fullWidth disabled={busyId === i.id} onClick={() => void accept(i.id)}>
                {t("caregiver.accept")}
              </Button>
            </Card>
          ))}
        </div>
      ) : null}
    </AppShell>
  );
}
