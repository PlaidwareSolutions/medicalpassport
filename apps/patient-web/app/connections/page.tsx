"use client";
import { useState } from "react";
import Link from "next/link";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { isStepUpRequired } from "../../lib/api";
import { isOpenLink, organizationKindLabelKey, revokeProviderLink, sectionLabelKey, useProviderLinks, type ProviderLinkDto } from "../../lib/connections";
import { useI18n } from "../../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../../lib/patient-time";
import { useProposals } from "../../lib/proposals";

/**
 * "Places that can see my record" (docs_v2/05 §11, docs_v2/06 P11-3): every
 * clinic, pharmacy, laboratory and hospital holding a link, exactly what
 * each one can see, until when — and one button that ends it. A patient who
 * cannot answer "who can see this, and how do I stop it?" does not have
 * control, only the appearance of it, so both answers live on this screen
 * rather than behind a settings page.
 *
 * Revoking is step-up guarded (ADR-V2-012), same as minting a new code.
 */
export default function ConnectionsPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items, error, fromCache, reload } = useProviderLinks();
  const { items: proposals } = useProposals("proposed");
  const [confirming, setConfirming] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [revokeError, setRevokeError] = useState<string | undefined>();

  const open = (items ?? []).filter(isOpenLink);
  const closed = (items ?? []).filter((l) => !isOpenLink(l));
  const waiting = proposals?.length ?? 0;

  async function revoke(link: ProviderLinkDto) {
    setBusy(link.id);
    setRevokeError(undefined);
    try {
      await revokeProviderLink(link.id);
      setConfirming(undefined);
      await reload();
    } catch (err) {
      setRevokeError(isStepUpRequired(err) ? t("stepup.not_confirmed") : err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("connections.title")} readAloud={[{ text: `${t("connections.title")}. ${t("guide.screen.connections")}` }]} />
      <p style={{ margin: "0 0 var(--space-md)" }}>{t("connections.intro")}</p>

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {revokeError ? <Banner tone="danger">{revokeError}</Banner> : null}

      <Link href="/connections/code">
        <Button fullWidth>{t("connections.show_code")}</Button>
      </Link>
      <p style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", margin: "var(--space-xs) 0 var(--space-md)" }}>{t("connections.show_code_hint")}</p>

      {waiting > 0 ? (
        <Link href="/proposals" style={{ textDecoration: "none", color: "inherit" }}>
          <Card tone="warning" data-testid="connections-waiting">
            <strong>{t("proposals.waiting_count", { count: waiting })}</strong>
            <span>{t("proposals.waiting_body")}</span>
          </Card>
        </Link>
      ) : null}

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState glyph="hospital" titleKey="connections.empty_title" bodyKey="connections.empty_body" cta={{ labelKey: "connections.show_code", href: "/connections/code" }} />
      ) : null}

      {open.length > 0 ? (
        <>
          <SectionTitle>{t("connections.open_title")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {open.map((link) => (
              <Card key={link.id} data-testid="provider-link" data-status="open">
                <strong style={{ fontSize: "var(--font-large)", overflowWrap: "anywhere" }}>{link.organization?.displayName ?? t("connections.unknown_organization")}</strong>
                <Chip>{t(organizationKindLabelKey(link.organization?.kind))}</Chip>
                <span>{t("connections.can_see")}</span>
                <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
                  {link.sections.map((s) => (
                    <Chip key={s}>{t(sectionLabelKey(s))}</Chip>
                  ))}
                </div>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t("connections.until", { date: formatPatientDate(link.expiresAt, timezone) })}
                </span>

                {confirming === link.id ? (
                  <Card tone="warning">
                    <strong>{t("connections.revoke_confirm_title")}</strong>
                    <span>{t("connections.revoke_confirm_body", { organization: link.organization?.displayName ?? t("connections.unknown_organization") })}</span>
                    <Button fullWidth loading={busy === link.id} disabled={busy === link.id} onClick={() => void revoke(link)} data-testid="confirm-revoke">
                      {t("connections.revoke_confirm")}
                    </Button>
                    <Button variant="ghost" fullWidth disabled={busy === link.id} onClick={() => setConfirming(undefined)}>
                      {t("common.cancel")}
                    </Button>
                  </Card>
                ) : (
                  <Button variant="secondary" fullWidth onClick={() => setConfirming(link.id)} data-testid="revoke-link">
                    {t("connections.revoke")}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {closed.length > 0 ? (
        <>
          <SectionTitle>{t("connections.closed_title")}</SectionTitle>
          <p style={{ margin: "0 0 var(--space-sm)", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("connections.closed_body")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {closed.map((link) => (
              <Card key={link.id} data-testid="provider-link" data-status="closed">
                <strong style={{ overflowWrap: "anywhere" }}>{link.organization?.displayName ?? t("connections.unknown_organization")}</strong>
                <Chip tone="default">{t(link.status === "revoked" ? "connections.status_revoked" : "connections.status_expired")}</Chip>
                <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t("connections.ended_on", { date: formatPatientDate(link.revokedAt ?? link.expiresAt, timezone) })}
                </span>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}
