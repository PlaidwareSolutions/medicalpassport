"use client";
import { useState } from "react";
import Link from "next/link";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import { consentStatusLabelKey, hiTypeLabelKey, revokeAbdmConsent, useAbdmConsents, type AbdmConsentDto } from "../../../lib/abha";
import { isStepUpRequired } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../../../lib/patient-time";

/**
 * ABDM consents (docs_v2/08 M8D). Deliberately a screen of its own, clearly
 * separated from the app's own sharing: a consent here is an agreement made
 * with India's health-records network, governed by its rules and revocable
 * through it — not a MedicinePassport share link. Collapsing the two into
 * one list would teach a patient something untrue about who holds what.
 *
 * Revoking is step-up guarded (ADR-V2-012).
 */
export default function AbdmConsentsPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items, error, fromCache, reload } = useAbdmConsents();
  const [revoking, setRevoking] = useState<string | undefined>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | undefined>();

  async function revoke(consent: AbdmConsentDto) {
    setBusy(true);
    setRevokeError(undefined);
    try {
      await revokeAbdmConsent(consent.id, reason);
      setRevoking(undefined);
      setReason("");
      await reload();
    } catch (err) {
      setRevokeError(isStepUpRequired(err) ? t("stepup.not_confirmed") : err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("abha.consents_title")} readAloud={[{ audio: "screen.abha_consents" }]} />
      <p style={{ margin: "0 0 var(--space-sm)" }}>{t("abha.consents_intro")}</p>
      {/* The distinction is the point of this screen — say it, don't imply it. */}
      <Banner tone="info">{t("abha.consents_not_shares")}</Banner>

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {revokeError ? <Banner tone="danger">{revokeError}</Banner> : null}

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <div style={{ marginTop: "var(--space-md)" }}>
          <EmptyState glyph="shield" titleKey="abha.consents_empty_title" bodyKey="abha.consents_empty_body" cta={{ labelKey: "abha.back_to_abha", href: "/abha" }} />
        </div>
      ) : null}

      {items && items.length > 0 ? (
        <>
          <SectionTitle>{t("abha.consents_list_title")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {items.map((consent) => {
              const revocable = consent.status === "granted" || consent.status === "requested";
              return (
                <Card key={consent.id} data-testid="abdm-consent" data-status={consent.status}>
                  <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                    <Chip tone={consent.status === "granted" ? "success" : consent.status === "revoked" ? "warning" : "default"}>
                      {t(consentStatusLabelKey(consent.status))}
                    </Chip>
                  </div>
                  <strong style={{ overflowWrap: "anywhere" }}>{consent.hiuId ?? t("abha.consent_unknown_requester")}</strong>
                  <span>{t("abha.consent_covers")}</span>
                  <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                    {consent.hiTypes.map((hiType) => (
                      <Chip key={hiType}>{t(hiTypeLabelKey(hiType))}</Chip>
                    ))}
                  </div>
                  {consent.dateRangeFrom && consent.dateRangeTo ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {t("abha.consent_range", {
                        from: formatPatientDate(consent.dateRangeFrom, timezone),
                        to: formatPatientDate(consent.dateRangeTo, timezone),
                      })}
                    </span>
                  ) : null}
                  {consent.dataEraseAt ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {t("abha.consent_erase_at", { date: formatPatientDate(consent.dataEraseAt, timezone) })}
                    </span>
                  ) : null}
                  {consent.revokedAt ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {t("abha.consent_revoked_on", { date: formatPatientDate(consent.revokedAt, timezone) })}
                    </span>
                  ) : null}

                  {revocable ? (
                    revoking === consent.id ? (
                      <Card tone="warning">
                        <strong>{t("abha.consent_revoke_title")}</strong>
                        <span>{t("abha.consent_revoke_body")}</span>
                        <TextInput label={t("abha.consent_revoke_reason")} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button fullWidth loading={busy} disabled={busy} onClick={() => void revoke(consent)} data-testid="confirm-revoke-consent">
                          {t("abha.consent_revoke_confirm")}
                        </Button>
                        <Button variant="ghost" fullWidth disabled={busy} onClick={() => setRevoking(undefined)}>
                          {t("common.cancel")}
                        </Button>
                      </Card>
                    ) : (
                      <Button variant="secondary" fullWidth onClick={() => { setRevoking(consent.id); setReason(""); }} data-testid="revoke-consent">
                        {t("abha.consent_revoke")}
                      </Button>
                    )
                  ) : null}
                </Card>
              );
            })}
          </div>
        </>
      ) : null}

      <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        <Link href="/abha">
          <Button variant="ghost" fullWidth>
            {t("abha.back_to_abha")}
          </Button>
        </Link>
        <Link href="/share">
          <Button variant="ghost" fullWidth>
            {t("abha.see_app_shares")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
