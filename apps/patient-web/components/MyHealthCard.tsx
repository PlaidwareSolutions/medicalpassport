"use client";
import Link from "next/link";
import { Button, Card, Chip, SectionTitle } from "@medpass/ui-web";
import { useHealthTimelineSummary } from "../lib/health-timeline";
import { useI18n } from "../lib/i18n";
import { formatPatientDateTime, useActiveTimezone } from "../lib/patient-time";
import { GuideGlyph } from "./GuideGlyph";

/**
 * The "My health" card on Home (docs_v2/00 §7 north star, docs_v2/05 §3):
 * counts from the timeline summary plus when something last happened, one
 * tap from the full Health Timeline. Renders nothing until at least one
 * count is above zero — an empty card would only compete with the dose
 * sections above it for a first-day patient's attention.
 */
export function MyHealthCard() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { summary } = useHealthTimelineSummary();
  if (!summary) return null;

  const tiles: Array<{ key: string; label: string; count: number }> = [
    { key: "medicines", label: t("health.summary.medicines"), count: summary.medicines?.active ?? 0 },
    { key: "prescriptions", label: t("health.summary.prescriptions"), count: summary.prescriptions ?? 0 },
    { key: "tests", label: t("health.summary.tests"), count: summary.tests ?? 0 },
    { key: "measurements", label: t("health.summary.measurements"), count: summary.measurements ?? 0 },
    { key: "documents", label: t("health.summary.documents"), count: summary.documents ?? 0 },
  ];
  const anyCount = tiles.some((x) => x.count > 0) || Object.values(summary.counts ?? {}).some((n) => (n ?? 0) > 0);
  if (!anyCount) return null;

  return (
    <>
      <SectionTitle>{t("health.summary_title")}</SectionTitle>
      <Card data-testid="my-health-card">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <span style={{ color: "var(--color-primary)" }}>
            <GuideGlyph name="timeline" size="md" />
          </span>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {summary.lastEventAt
              ? t("health.summary_last_event", { when: formatPatientDateTime(summary.lastEventAt, timezone) })
              : t("health.summary_intro")}
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
          {tiles
            .filter((x) => x.count > 0)
            .map((x) => (
              <Chip key={x.key}>
                {x.count} {x.label}
              </Chip>
            ))}
        </div>
        <Link href="/health">
          <Button variant="secondary" fullWidth>
            {t("health.summary_open")}
          </Button>
        </Link>
      </Card>
    </>
  );
}
