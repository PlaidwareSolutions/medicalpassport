"use client";
import { Banner, Card, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { DoseCard } from "../../components/DoseCard";
import { useI18n } from "../../lib/i18n";
import { useTimeline } from "../../lib/timeline";

const SLOT_ORDER = ["morning", "midday", "night"] as const;

/** Screen 8: Today's medication timeline (docs/07), grouped by slot. */
export default function TimelinePage() {
  const { t } = useI18n();
  const { data, error, reload } = useTimeline();

  return (
    <AppShell>
      <h1 style={{ fontSize: "var(--font-title)", margin: "0 0 var(--space-sm)" }}>{t("timeline.title")}</h1>

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {!data && !error ? <p style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</p> : null}

      {data && data.items.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>{t("timeline.empty")}</p>
        </Card>
      ) : null}

      {data
        ? SLOT_ORDER.map((slot) => {
            const items = data.items.filter((i) => i.slotLabel === slot);
            if (items.length === 0) return null;
            return (
              <div key={slot}>
                <SectionTitle>{t(`timeline.slot.${slot}` as never)}</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                  {items.map((item) => (
                    <DoseCard key={item.scheduledDoseId} item={item} onChanged={reload} />
                  ))}
                </div>
              </div>
            );
          })
        : null}
    </AppShell>
  );
}
