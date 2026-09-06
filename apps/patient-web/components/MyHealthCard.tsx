"use client";
import Link from "next/link";
import { Button, Card, SectionTitle } from "@medpass/ui-web";
import { useHealthTimelineSummary } from "../lib/health-timeline";
import { useI18n } from "../lib/i18n";
import { formatPatientDateTime, useActiveTimezone } from "../lib/patient-time";
import { GuideGlyph, type GuideGlyphName } from "./GuideGlyph";

/**
 * The "My health record" card on Home (docs_v2/00 §7 north star, docs_v2/05
 * §3): one tile per area of the record with its count, each a tap away, and
 * the health timeline beneath. Always rendered — a first-day patient needs
 * the doors to exist before there is anything behind them, and until V2 the
 * only way into documents, measurements or the family view was to know the
 * address. Counts appear once they are above zero.
 */
export function MyHealthCard() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { summary } = useHealthTimelineSummary();

  const tiles: Array<{ key: string; href: string; glyph: GuideGlyphName; label: string; count: number; countLabel: string }> = [
    { key: "health", href: "/health", glyph: "timeline", label: t("home.tile.health"), count: summary?.medicines?.active ?? 0, countLabel: t("health.summary.medicines") },
    { key: "documents", href: "/documents", glyph: "document", label: t("home.tile.documents"), count: summary?.documents ?? 0, countLabel: t("health.summary.documents") },
    { key: "tests", href: "/reports", glyph: "report", label: t("home.tile.tests"), count: summary?.tests ?? 0, countLabel: t("health.summary.tests") },
    { key: "measurements", href: "/measurements", glyph: "pulse", label: t("home.tile.measurements"), count: summary?.measurements ?? 0, countLabel: t("health.summary.measurements") },
    { key: "family", href: "/family", glyph: "family", label: t("home.tile.family"), count: 0, countLabel: "" },
  ];

  return (
    <>
      <SectionTitle>{t("home.record_title")}</SectionTitle>
      <Card data-testid="my-health-card">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
          <span style={{ color: "var(--color-primary)" }}>
            <GuideGlyph name="timeline" size="md" />
          </span>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {summary?.lastEventAt
              ? t("health.summary_last_event", { when: formatPatientDateTime(summary.lastEventAt, timezone) })
              : t("health.summary_intro")}
          </span>
        </div>
        <nav aria-label={t("home.record_title")} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--size-touch-gap)" }}>
          {tiles.map((x) => (
            <Link key={x.key} href={x.href} style={{ textDecoration: "none", color: "inherit" }} data-testid={`home-tile-${x.key}`}>
              <div
                style={{
                  minHeight: "var(--size-touch)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  padding: "var(--space-sm)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                }}
              >
                <span style={{ color: "var(--color-primary)" }} aria-hidden="true">
                  <GuideGlyph name={x.glyph} size="md" />
                </span>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                  <strong style={{ display: "block" }}>{x.label}</strong>
                  {x.count > 0 ? (
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {x.count} {x.countLabel}
                    </span>
                  ) : null}
                </span>
              </div>
            </Link>
          ))}
        </nav>
        <Link href="/health">
          <Button variant="secondary" fullWidth>
            {t("health.summary_open")}
          </Button>
        </Link>
      </Card>
    </>
  );
}
