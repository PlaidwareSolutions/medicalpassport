"use client";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { organizationKindLabelKey } from "../../lib/connections";
import { useI18n } from "../../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../../lib/patient-time";
import { kindLabelKey, proposalSummary, useProposals, type ProposalDto } from "../../lib/proposals";

/**
 * The proposals inbox (docs_v2/06 P11-5, ADR-V2-009). Everything a clinic,
 * pharmacy, laboratory or hospital has sent and the patient has not yet
 * answered — grouped by who sent it, because "who is asking" is the first
 * thing a person needs to judge the ask. Each row names the organization
 * and says, in plain words, what accepting it would change. Nothing on this
 * screen has touched the record: these are requests, not events.
 */
export default function ProposalsPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items, error, fromCache, hasMore, loadMore, loadingMore } = useProposals("proposed");

  const groups = groupByOrganization(items ?? []);

  return (
    <AppShell>
      <PageHeader title={t("proposals.title")} readAloud={[{ audio: "screen.proposals" }]} />
      <p style={{ margin: "0 0 var(--space-md)" }}>{t("proposals.intro")}</p>

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        <EmptyState glyph="hospital" titleKey="proposals.empty_title" bodyKey="proposals.empty_body" cta={{ labelKey: "connections.title", href: "/connections" }} />
      ) : null}

      {groups.map((group) => (
        <section key={group.organizationId} aria-label={group.displayName}>
          <SectionTitle>{group.displayName}</SectionTitle>
          <div style={{ marginBottom: "var(--space-xs)" }}>
            <Chip>{t(organizationKindLabelKey(group.kind))}</Chip>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {group.proposals.map((p) => (
              <Link key={p.id} href={`/proposals/${p.id}`} style={{ textDecoration: "none", color: "inherit" }} data-testid="proposal-row" data-kind={p.kind}>
                <Card>
                  <strong style={{ fontSize: "var(--font-large)" }}>{t(kindLabelKey(p.kind))}</strong>
                  <span style={{ overflowWrap: "anywhere" }}>{proposalSummary(p, t)}</span>
                  <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {t("proposals.sent_by", { organization: group.displayName, date: formatPatientDate(p.proposedAt, timezone) })}
                  </span>
                  <Chip tone="warning">{t("proposals.awaiting_you")}</Chip>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {hasMore ? (
        <div style={{ marginTop: "var(--space-md)" }}>
          <Button variant="secondary" fullWidth loading={loadingMore} disabled={loadingMore} onClick={() => void loadMore()}>
            {t("proposals.show_more")}
          </Button>
        </div>
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <Link href="/connections">
            <Button variant="ghost" fullWidth>
              {t("proposals.see_connections")}
            </Button>
          </Link>
        </div>
      ) : null}
    </AppShell>
  );
}

interface OrganizationGroup {
  organizationId: string;
  displayName: string;
  kind: string;
  proposals: ProposalDto[];
}

/** Newest-first within each organization; organizations ordered by their newest proposal. */
function groupByOrganization(items: readonly ProposalDto[]): OrganizationGroup[] {
  const out: OrganizationGroup[] = [];
  for (const p of items) {
    const existing = out.find((g) => g.organizationId === p.organization.id);
    if (existing) existing.proposals.push(p);
    else out.push({ organizationId: p.organization.id, displayName: p.organization.displayName, kind: p.organization.kind, proposals: [p] });
  }
  return out;
}
