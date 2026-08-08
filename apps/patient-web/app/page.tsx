"use client";
import Link from "next/link";
import { Banner, Button, Card, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { CaregiverAlertCard } from "../components/CaregiverAlertCard";
import { DoseCard } from "../components/DoseCard";
import { FindingCard } from "../components/FindingCard";
import { InstallEducationCard } from "../components/InstallEducationCard";
import { PageHeader } from "../components/PageHeader";
import { RefillReminderCard } from "../components/RefillReminderCard";
import { useGlucoseReadings } from "../lib/blood-sugar";
import { useCaregiverAlerts } from "../lib/caregiver-alerts";
import { useI18n } from "../lib/i18n";
import { useMedications } from "../lib/medications";
import { useRefillReminders } from "../lib/refill-reminders";
import { isOpenFinding, useSafetyFindings } from "../lib/safety";
import { useTimeline } from "../lib/timeline";

/** Screen 7: Home (docs/07). Priority order: due now → due next → missed → concerns → refill/completion reminders. */
export default function HomePage() {
  const { t } = useI18n();
  const { items: medications, error: medError } = useMedications("current");
  const { data: timeline, error: timelineError, fromCache, patchItem } = useTimeline();
  const { items: findings, reload: reloadFindings } = useSafetyFindings();
  const { items: refillReminders, reload: reloadRefillReminders } = useRefillReminders();
  const { items: caregiverAlerts } = useCaregiverAlerts();
  const { items: glucoseReadings } = useGlucoseReadings();

  const dueNow = (timeline?.items ?? []).filter((i) => i.isDueNow && i.status !== "missed");
  const missed = (timeline?.items ?? []).filter((i) => i.status === "missed");
  const dueNext = (timeline?.items ?? [])
    .filter((i) => i.status === "upcoming" && !i.isDueNow)
    .slice(0, 3);
  const openFindings = (findings ?? []).filter(isOpenFinding);

  const noMedicinesAtAll = medications !== undefined && medications.length === 0;
  const hasAnySchedule = (timeline?.items.length ?? 0) > 0;
  const latestReading = glucoseReadings?.[0];

  return (
    <AppShell>
      <PageHeader title={t("nav.home")} readAloud={[{ audio: "screen.home" }]} />

      {medError || timelineError ? <Card tone="danger">{t("common.error_generic")}</Card> : null}
      {fromCache ? <Banner tone="warning">{t("common.offline_banner")}</Banner> : null}

      {medications === undefined && !medError ? <PillSpinner label={t("common.loading")} /> : null}

      {noMedicinesAtAll ? (
        <EmptyState
          glyph="tablet"
          titleKey="home.empty_title"
          bodyKey="home.empty_body"
          audioId="empty.home"
          cta={{ labelKey: "home.add_first", href: "/add" }}
        />
      ) : null}

      {glucoseReadings ? (
        <>
          <SectionTitle>{t("home.blood_sugar")}</SectionTitle>
          <Card>
            {latestReading ? (
              <>
                <strong>
                  {latestReading.valueMgDl} {t("bloodsugar.mg_dl_unit")}
                </strong>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                  {t(`bloodsugar.context.${latestReading.context}` as never)} ·{" "}
                  {new Date(latestReading.measuredAt).toLocaleString()}
                </div>
              </>
            ) : (
              <span style={{ color: "var(--color-text-muted)" }}>{t("bloodsugar.readings_empty")}</span>
            )}
            <div style={{ marginTop: "var(--space-sm)" }}>
              <Link href="/blood-sugar">
                <Button fullWidth variant={latestReading ? "secondary" : "primary"}>
                  {t("bloodsugar.add_reading")}
                </Button>
              </Link>
            </div>
          </Card>
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
                <DoseCard key={item.scheduledDoseId} item={item} onAction={(id, patch) => void patchItem(id, patch)} />
              ))}
            </div>
          )}

          {dueNext.length > 0 ? (
            <>
              <SectionTitle>{t("home.due_next")}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {dueNext.map((item) => (
                  <DoseCard key={item.scheduledDoseId} item={item} onAction={(id, patch) => void patchItem(id, patch)} />
                ))}
              </div>
            </>
          ) : null}

          {missed.length > 0 ? (
            <>
              <SectionTitle>{t("home.missed")}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {missed.map((item) => (
                  <DoseCard key={item.scheduledDoseId} item={item} onAction={(id, patch) => void patchItem(id, patch)} />
                ))}
              </div>
            </>
          ) : null}

          {openFindings.length > 0 ? (
            <>
              <SectionTitle>
                {t("home.concerns")} · {t("home.concerns_count", { count: openFindings.length })}
              </SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {openFindings.map((f) => (
                  <FindingCard key={f.id} finding={f} onChanged={reloadFindings} />
                ))}
              </div>
            </>
          ) : null}

          {caregiverAlerts && caregiverAlerts.length > 0 ? (
            <>
              <SectionTitle>{t("home.alert_history")}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {caregiverAlerts.map((a) => (
                  <CaregiverAlertCard key={a.scheduledDoseId} alert={a} />
                ))}
              </div>
            </>
          ) : null}

          {refillReminders && refillReminders.length > 0 ? (
            <>
              <SectionTitle>{t("home.refill_reminders")}</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {refillReminders.map((r) => (
                  <RefillReminderCard key={r.notificationId} reminder={r} onChanged={reloadRefillReminders} />
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

          {/* Screen 37: install education only after value delivered (≥1
              medicine), at the bottom — an offer, never a gate. */}
          <InstallEducationCard />
        </>
      ) : null}
    </AppShell>
  );
}
