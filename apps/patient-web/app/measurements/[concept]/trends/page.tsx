"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { TREND_BUCKETS, TREND_WINDOWS, type TrendBucket, type TrendWindow } from "@medpass/domain";
import { Banner, Button, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { EmptyState } from "../../../../components/EmptyState";
import { PageHeader } from "../../../../components/PageHeader";
import { TrendChart, type TrendSeries } from "../../../../components/TrendChart";
import { useI18n } from "../../../../lib/i18n";
import { bucketLabel, conceptGlyph, formatObservationValue, isHubConcept, useObservationTrend, type TrendPointDto } from "../../../../lib/observations";

/**
 * One concept's trend (docs_v2/05 §7, docs_v2/06 P5-3): 7d / 30d / 90d,
 * bucketed by day / week / month on the patient's own calendar, drawn as
 * the bucket averages (BP as two series with distinct marker shapes), a
 * table alternative with every bucket's count / average / min–max, and the
 * morning / evening split. Descriptive only: no band, no verdict (H-25).
 */
export default function MeasurementTrendPage() {
  const { t, tn, locale } = useI18n();
  const params = useParams<{ concept: string }>();
  const concept = isHubConcept(params.concept) ? params.concept : undefined;
  const [window, setWindow] = useState<TrendWindow>("30d");
  const [bucket, setBucket] = useState<TrendBucket>("day");
  const { trend, error } = useObservationTrend(concept ?? "body_weight", window, bucket);

  if (!concept) {
    return (
      <AppShell>
        <Banner tone="danger">{t("measure.unknown_concept")}</Banner>
      </AppShell>
    );
  }

  const unit = concept === "pain_score" ? "/10" : (trend?.unitDisplay ?? trend?.unit ?? "");
  const isBp = concept === "blood_pressure";
  const fmt = (v: number | null) => (v == null ? "—" : formatObservationValue(v, concept));
  const range = (p: Pick<TrendPointDto, "min" | "max" | "min2" | "max2">) =>
    isBp ? `${fmt(p.min)}/${fmt(p.min2)} – ${fmt(p.max)}/${fmt(p.max2)}` : `${fmt(p.min)} – ${fmt(p.max)}`;
  const avg = (p: Pick<TrendPointDto, "average" | "average2">) => (isBp ? `${fmt(p.average)}/${fmt(p.average2)}` : fmt(p.average));

  const points = trend?.points ?? [];
  const xOf = (b: string) => {
    const [y, m, d] = b.split("-").map(Number);
    return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
  };
  const series: TrendSeries[] = [
    {
      key: "primary",
      label: isBp ? t("measure.systolic_short") : t(`measure.concept.${concept}` as never),
      marker: "circle",
      points: points.filter((p) => p.average != null).map((p) => ({ id: `${p.bucket}-1`, x: xOf(p.bucket), y: p.average!, label: `${formatObservationValue(p.average, concept)} ${unit} · ${bucketLabel(p.bucket, bucket, locale)}` })),
    },
    ...(isBp
      ? [
          {
            key: "secondary",
            label: t("measure.diastolic_short"),
            marker: "square" as const,
            dashed: true,
            points: points.filter((p) => p.average2 != null).map((p) => ({ id: `${p.bucket}-2`, x: xOf(p.bucket), y: p.average2!, label: `${formatObservationValue(p.average2, concept)} ${unit} · ${bucketLabel(p.bucket, bucket, locale)}` })),
          },
        ]
      : []),
  ];

  return (
    <AppShell>
      <PageHeader title={t("measure.trend_title", { name: t(`measure.concept.${concept}` as never) })} readAloud={[{ audio: "screen.measurement_trend" }]} />
      {error && !trend ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}

      <div role="group" aria-label={t("measure.window_label")} style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        {TREND_WINDOWS.map((w) => (
          <Button key={w} variant={window === w ? "primary" : "secondary"} aria-pressed={window === w} onClick={() => setWindow(w)} style={{ flex: "1 1 auto" }}>
            {t(`measure.window.${w}` as never)}
          </Button>
        ))}
      </div>
      <div role="group" aria-label={t("measure.bucket_label")} style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap", marginTop: "var(--space-sm)" }}>
        {TREND_BUCKETS.map((b) => (
          <Button key={b} variant={bucket === b ? "primary" : "secondary"} aria-pressed={bucket === b} onClick={() => setBucket(b)} style={{ flex: "1 1 auto" }}>
            {t(`measure.bucket.${b}` as never)}
          </Button>
        ))}
      </div>

      {!trend && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {trend && points.length === 0 ? (
        <EmptyState glyph={conceptGlyph(concept)} titleKey="measure.trend_empty_title" bodyKey="measure.trend_empty_body" cta={{ labelKey: "bp.add_reading", href: `/measurements/${concept}` }} />
      ) : null}

      {trend && points.length > 0 ? (
        <>
          <Card>
            <TrendChart
              series={series}
              unit={unit}
              formatX={(x) => new Date(x).toLocaleDateString(locale === "en" ? undefined : locale, { day: "numeric", month: "short", timeZone: "UTC" })}
              ariaLabel={tn(points.length, "measure.chart_aria_one", "measure.chart_aria", { name: t(`measure.concept.${concept}` as never), unit })}
              tableCaption={t("measure.table_caption", { name: t(`measure.concept.${concept}` as never), unit })}
              tableHeaders={[t("measure.col_bucket"), t("measure.col_count"), t("measure.col_average"), t("measure.col_range"), t("measure.col_morning"), t("measure.col_evening")]}
              tableRows={points.map((p) => ({
                id: p.bucket,
                cells: [bucketLabel(p.bucket, bucket, locale), String(p.count), avg(p), range(p), fmt(p.morning.average), fmt(p.evening.average)],
              }))}
            />
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("trend.no_judgement_note")}</span>
          </Card>

          <SectionTitle>{t("measure.summary_title", { window: t(`measure.window.${window}` as never) })}</SectionTitle>
          <Card data-testid="trend-summary">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-md)" }}>
              <Stat label={t("measure.col_count")} value={String(trend.summary.count)} />
              <Stat label={t("measure.col_average")} value={`${avg(trend.summary)} ${unit}`} />
              <Stat label={t("measure.col_range")} value={`${range(trend.summary)} ${unit}`} />
              <Stat label={t("measure.col_morning")} value={trend.summary.morning.count > 0 ? `${fmt(trend.summary.morning.average)} ${unit} · ${tn(trend.summary.morning.count, "measure.n_readings_one", "measure.n_readings")}` : "—"} />
              <Stat label={t("measure.col_evening")} value={trend.summary.evening.count > 0 ? `${fmt(trend.summary.evening.average)} ${unit} · ${tn(trend.summary.evening.count, "measure.n_readings_one", "measure.n_readings")}` : "—"} />
            </div>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("measure.split_note")}</span>
          </Card>
        </>
      ) : null}

      <Link href={`/measurements/${concept}`}>
        <Button variant="secondary" fullWidth>
          {t("measure.back_to_diary")}
        </Button>
      </Link>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
      <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)", fontWeight: 600 }}>{label}</span>
      <span style={{ overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}
