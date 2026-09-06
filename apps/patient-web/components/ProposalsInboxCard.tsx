"use client";
import Link from "next/link";
import { Card, Chip } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { useProposals } from "../lib/proposals";
import { GuideGlyph } from "./GuideGlyph";

/**
 * Home's entry point into the proposals inbox (docs_v2/06 P11-5). Renders
 * nothing at all when nothing is waiting: a permanent "0 waiting" row would
 * compete with the doses for a first-day patient's attention and teach
 * them to ignore the spot where a real request will one day appear.
 */
export function ProposalsInboxCard() {
  const { t } = useI18n();
  const { items } = useProposals("proposed");
  const count = items?.length ?? 0;
  if (count === 0) return null;

  return (
    <Link href="/proposals" style={{ textDecoration: "none", color: "inherit" }}>
      <Card tone="warning" data-testid="proposals-home-card">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <span style={{ color: "var(--color-warning)" }}>
            <GuideGlyph name="hospital" size="md" />
          </span>
          <strong style={{ fontSize: "var(--font-large)" }}>{t("proposals.waiting_count", { count })}</strong>
        </div>
        <span>{t("proposals.waiting_body")}</span>
        <Chip tone="warning">{t("proposals.waiting_open")}</Chip>
      </Card>
    </Link>
  );
}
