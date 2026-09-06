"use client";
import Link from "next/link";
import { Banner, Button, Card, Chip, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { GuideGlyph } from "../../components/GuideGlyph";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { conceptGlyph, HUB_CONCEPTS, latestPerConcept, observationValueText, useObservations } from "../../lib/observations";
import { formatPatientDateTime, useActiveTimezone } from "../../lib/patient-time";

/**
 * The Measurements hub (docs_v2/06 P5-3): one card per concept with the
 * latest reading, its context and the patient-local time, each opening
 * that concept's diary. The V1 blood sugar / blood pressure / weight
 * screens redirect here. Numbers only — no colour by value, no verdict
 * (docs_v2/10 §1).
 */
export default function MeasurementsHubPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items, error, fromCache } = useObservations();
  const latest = latestPerConcept(items ?? []);

  return (
    <AppShell>
      <PageHeader title={t("measure.title")} readAloud={[{ audio: "screen.measurements" }]} />
      {error && !items ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? <EmptyState glyph="pulse" titleKey="measure.empty_title" bodyKey="measure.empty_body" /> : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {HUB_CONCEPTS.map((concept) => {
          const o = latest.get(concept);
          return (
            <Link key={concept} href={`/measurements/${concept}`} data-testid={`measure-card-${concept}`}>
              <Card>
                <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-start" }}>
                  <span style={{ color: "var(--color-primary)", flexShrink: 0 }}>
                    <GuideGlyph name={conceptGlyph(concept)} size="md" />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong>{t(`measure.concept.${concept}` as never)}</strong>
                    {o ? (
                      <>
                        <div style={{ fontSize: "var(--font-large)" }}>{observationValueText(o)}</div>
                        <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", display: "flex", gap: "var(--space-xs)", flexWrap: "wrap", alignItems: "center" }}>
                          {o.context ? <Chip>{t(`measure.context.${o.context}` as never)}</Chip> : null}
                          <span>{formatPatientDateTime(o.measuredAt, timezone)}</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("measure.no_reading_yet")}</div>
                    )}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
        <Link href="/measurements/checkups">
          <Button variant="secondary" fullWidth>
            {t("bloodsugar.tab_checkups")}
          </Button>
        </Link>
        <Link href="/measurements/devices">
          <Button variant="secondary" fullWidth>
            {t("device.title")}
          </Button>
        </Link>
      </div>
    </AppShell>
  );
}
