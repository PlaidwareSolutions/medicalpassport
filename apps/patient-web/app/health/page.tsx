"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Banner, Button, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { HealthEventRow } from "../../components/HealthEventRow";
import { PageHeader } from "../../components/PageHeader";
import { KIND_GROUPS, localDayKey, useHealthTimeline, type HealthEventDto, type KindGroup } from "../../lib/health-timeline";
import { useI18n } from "../../lib/i18n";
import { patientTodayKey, useActiveTimezone } from "../../lib/patient-time";

/**
 * Health Timeline (docs_v2/00 §7, docs_v2/06 P1-4): everything that happened
 * to this patient's health, newest first, grouped by the patient's own day
 * (`occurredAtLocal`, docs/16 — never the viewer's zone). Kind-group chips
 * narrow the feed; the cursor pages in as the list is scrolled, with a
 * plain "Show more" button as the keyboard/screen-reader path.
 */
export default function HealthTimelinePage() {
  const { t, locale } = useI18n();
  const timezone = useActiveTimezone();
  const [groups, setGroups] = useState<KindGroup[]>([]);
  const { items, error, fromCache, hasMore, loadMore, loadingMore, moreError } = useHealthTimeline(groups);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const days = useMemo(() => groupByDay(items ?? []), [items]);
  const todayKey = patientTodayKey(timezone);
  const yesterdayKey = patientTodayKey(timezone, new Date(Date.now() - 24 * 60 * 60 * 1000));

  function dayLabel(key: string): string {
    if (key === todayKey) return t("health.day_today");
    if (key === yesterdayKey) return t("health.day_yesterday");
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale === "en" ? undefined : locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function toggle(group: KindGroup) {
    setGroups((prev) => (prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group]));
  }

  return (
    <AppShell>
      <PageHeader title={t("health.title")} readAloud={[{ audio: "screen.health" }]} />

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}

      <Link href="/health/visits">
        <Button variant="secondary" fullWidth>
          {t("health.visits_link")}
        </Button>
      </Link>

      {/* Filter chips: multi-select toggles; none pressed = everything. */}
      <div role="group" aria-label={t("health.filter_label")} style={{ display: "flex", flexWrap: "wrap", gap: "var(--size-touch-gap)", margin: "var(--space-sm) 0" }}>
        {KIND_GROUPS.map((group) => {
          const pressed = groups.includes(group);
          return (
            <Button
              key={group}
              variant={pressed ? "primary" : "secondary"}
              aria-pressed={pressed}
              onClick={() => toggle(group)}
              style={{ flex: "1 1 auto" }}
            >
              {t(`health.group.${group}` as never)}
            </Button>
          );
        })}
      </div>

      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 ? (
        groups.length === 0 ? (
          <EmptyState
            glyph="timeline"
            titleKey="health.empty_title"
            bodyKey="health.empty_body"
            cta={{ labelKey: "encounter.add", href: "/health/visits/new" }}
          />
        ) : (
          <Card tone="info">
            <span style={{ color: "var(--color-text-muted)" }}>{t("health.filter_empty")}</span>
          </Card>
        )
      ) : null}

      {days.map(({ key, events }) => (
        <section key={key} aria-label={dayLabel(key)}>
          <SectionTitle>{dayLabel(key)}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {events.map((event) => (
              <HealthEventRow key={event.id} event={event} />
            ))}
          </div>
        </section>
      ))}

      {moreError ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {hasMore ? (
        <div ref={sentinelRef} style={{ marginTop: "var(--space-md)" }}>
          <Button variant="secondary" fullWidth loading={loadingMore} disabled={loadingMore} onClick={() => void loadMore()}>
            {t("health.show_more")}
          </Button>
        </div>
      ) : null}
    </AppShell>
  );
}

function groupByDay(items: HealthEventDto[]): Array<{ key: string; events: HealthEventDto[] }> {
  const out: Array<{ key: string; events: HealthEventDto[] }> = [];
  for (const event of items) {
    const key = localDayKey(event);
    const last = out[out.length - 1];
    if (last && last.key === key) last.events.push(event);
    else out.push({ key, events: [event] });
  }
  return out;
}
