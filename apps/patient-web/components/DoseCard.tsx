"use client";
import { useState } from "react";
import type { TimelineItemDto } from "@medpass/api-client";
import { Button, Card, Chip } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { recordDoseEvent } from "../lib/timeline";

const STATUS_TONE: Record<string, "default" | "success" | "warning" | "danger"> = {
  upcoming: "default",
  taken: "success",
  skipped: "warning",
  missed: "danger",
  snoozed: "warning",
  could_not_take: "danger",
  unavailable: "danger",
  problem: "danger",
  taken_other_time: "success",
  cancelled: "default",
};

const RESOLVED_STATUSES = new Set([
  "taken",
  "skipped",
  "missed",
  "could_not_take",
  "unavailable",
  "problem",
  "taken_other_time",
  "cancelled",
]);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Screen 24: record dose (docs/07). One-tap primary actions, "more options" folds the rest. */
export function DoseCard({ item, onChanged }: { item: TimelineItemDto; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const resolved = RESOLVED_STATUSES.has(item.status);

  async function act(action: string, snoozeMinutes?: number) {
    setBusy(true);
    try {
      await recordDoseEvent(item.scheduledDoseId, action, snoozeMinutes ? { snoozeMinutes } : undefined);
      onChanged();
    } finally {
      setBusy(false);
      setShowMore(false);
    }
  }

  return (
    <Card tone={item.isDueNow && !resolved ? "info" : "default"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "var(--space-sm)" }}>
        <div>
          <strong style={{ fontSize: "var(--font-large)" }}>{item.medication.name}</strong>
          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {formatTime(item.dueAt)} · {item.quantity} {item.medication.doseUnit} ·{" "}
            {t(`food.${item.medication.foodInstruction}` as never)}
          </div>
        </div>
        <Chip tone={STATUS_TONE[item.status]}>{t(`timeline.status.${item.status}` as never)}</Chip>
      </div>

      {!resolved ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button disabled={busy} onClick={() => void act("taken")}>
              {t("dose.action.taken")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void act("skipped")}>
              {t("dose.action.skipped")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void act("snoozed", 10)}>
              {t("dose.action.snooze_10")}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setShowMore((s) => !s)}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-small)",
              textDecoration: "underline",
              cursor: "pointer",
              alignSelf: "flex-start",
              padding: 0,
            }}
          >
            {t("dose.action.more")}
          </button>
          {showMore ? (
            <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
              <Button variant="secondary" disabled={busy} onClick={() => void act("could_not_take")}>
                {t("dose.action.could_not_take")}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void act("unavailable")}>
                {t("dose.action.unavailable")}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void act("problem")}>
                {t("dose.action.problem")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
