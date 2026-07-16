"use client";
import Link from "next/link";
import { Button, Card, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../components/AppShell";
import { DoseCard } from "../components/DoseCard";
import { useI18n } from "../lib/i18n";
import { useMedications } from "../lib/medications";
import { useTimeline } from "../lib/timeline";

/**
 * Screen 7: Home (docs/07). Priority order: due now → due next → missed →
 * concerns → refills. Concerns (Stage 6) and refills (later) are not built
 * yet; this shows the three schedule-derived sections that exist today.
 */
export default function HomePage() {
  const { t } = useI18n();
  const { items: medications, error: medError } = useMedications("current");
  const { data: timeline, error: timelineError, reload } = useTimeline();

  const dueNow = (timeline?.items ?? []).filter((i) => i.isDueNow && i.status !== "missed");
  const missed = (timeline?.items ?? []).filter((i) => i.status === "missed");
  const dueNext = (timeline?.items ?? [])
    .filter((i) => i.status === "upcoming" && !i.isDueNow)
    .slice(0, 3);

  const noMedicinesAtAll = medications !== undefined && medications.length === 0;
  const hasAnySchedule = (timeline?.items.length ?? 0) > 0;

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("nav.home")}</h1>

      {medError || timelineError ? <Card tone="danger">{t("common.error_generic")}</Card> : null}

      {medications === undefined && !medError ? <p style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</p> : null}

      {noMedicinesAtAll ? (
        <Card>
          <strong>{t("home.empty_title")}</strong>
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>{t("home.empty_body")}</p>
          <Link href="/add">
            <Button fullWidth>{t("home.add_first")}</Button>
          </Link>
        </Card>
      ) : null}

      {missed.length > 0 ? (
        <>
          <SectionTitle>{t("home.missed")}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {missed.map((item) => (
              <DoseCard key={item.scheduledDoseId} item={item} onChanged={reload} />
            ))}
          </div>
        </>
      ) : null}

      {medications && medications.length > 0 ? (
        <>
          <SectionTitle>{t("home.due_now")}</SectionTitle>
          {dueNow.length === 0 ? (
            <Card tone="info">
              <span style={{ color: "var(--color-text-muted)" }}>{t("home.all_done")}</span>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {dueNow.map((item) => (
                <DoseCard key={item.scheduledDoseId} item={item} onChanged={reload} />
              ))}
            </div>
          )}

          {dueNext.length > 0 ? (
            <>
              <SectionTitle>{t("home.due_next")}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {dueNext.map((item) => (
                  <DoseCard key={item.scheduledDoseId} item={item} onChanged={reload} />
                ))}
              </div>
            </>
          ) : null}

          {hasAnySchedule ? (
            <Link href="/timeline">
              <Button variant="secondary" fullWidth>
                {t("home.view_timeline")}
              </Button>
            </Link>
          ) : null}
        </>
      ) : null}
    </AppShell>
  );
}
