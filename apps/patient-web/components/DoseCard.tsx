"use client";
import { useId, useState } from "react";
import type { TimelineItemDto } from "@medpass/api-client";
import { Button, Card, Chip, TextInput } from "@medpass/ui-web";
import { ClinicalContentBlock } from "./ClinicalContentBlock";
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

/** Local "YYYY-MM-DDTHH:mm" for an `<input type="datetime-local">`, in the browser's own timezone. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Screen 24: record dose (docs/07). One-tap primary actions, "more options" folds the rest. */
export function DoseCard({
  item,
  onAction,
}: {
  item: TimelineItemDto;
  /** Applies the new state immediately — an optimistic patch, not a reload (docs/15). */
  onAction: (scheduledDoseId: string, patch: Partial<TimelineItemDto>) => void;
}) {
  const { t } = useI18n();
  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [showMore, setShowMore] = useState(false);
  const [justQueued, setJustQueued] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionTime, setCorrectionTime] = useState("");
  const moreOptionsId = useId();

  const resolved = RESOLVED_STATUSES.has(item.status);
  const isMissed = item.status === "missed";
  const busy = busyAction !== undefined;

  async function act(action: string, snoozeMinutes?: number, effectiveAt?: string) {
    setBusyAction(action);
    try {
      const result = await recordDoseEvent(item.scheduledDoseId, action, { snoozeMinutes, effectiveAt });
      setJustQueued(result.queuedOffline);
      const patch: Partial<TimelineItemDto> = { status: result.status, isDueNow: false };
      if (action === "snoozed") {
        patch.snoozedUntil = new Date(Date.now() + (snoozeMinutes ?? 10) * 60_000).toISOString();
      }
      onAction(item.scheduledDoseId, patch);
    } finally {
      setBusyAction(undefined);
      setShowMore(false);
      setShowCorrection(false);
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

      {justQueued ? (
        <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
          {t("dose.queued_offline")}
        </span>
      ) : null}

      {!resolved ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button loading={busyAction === "taken"} disabled={busy} onClick={() => void act("taken")}>
              {t("dose.action.taken")}
            </Button>
            <Button variant="secondary" loading={busyAction === "skipped"} disabled={busy} onClick={() => void act("skipped")}>
              {t("dose.action.skipped")}
            </Button>
            <Button variant="ghost" loading={busyAction === "snoozed"} disabled={busy} onClick={() => void act("snoozed", 10)}>
              {t("dose.action.snooze_10")}
            </Button>
          </div>
          <button
            type="button"
            aria-expanded={showMore}
            aria-controls={moreOptionsId}
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
            <div id={moreOptionsId} style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
              <Button variant="secondary" loading={busyAction === "could_not_take"} disabled={busy} onClick={() => void act("could_not_take")}>
                {t("dose.action.could_not_take")}
              </Button>
              <Button variant="secondary" loading={busyAction === "unavailable"} disabled={busy} onClick={() => void act("unavailable")}>
                {t("dose.action.unavailable")}
              </Button>
              <Button variant="danger" loading={busyAction === "problem"} disabled={busy} onClick={() => void act("problem")}>
                {t("dose.action.problem")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : isMissed ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <ClinicalContentBlock
            title={t("meds.missed_dose")}
            entry={item.medication.missedDoseGuidance}
            emptyMessage={t("meds.missed_dose_empty")}
            t={t as never}
          />
          {/* docs/07 screen 26: shown regardless of whether guidance exists — never just the empty-case wording. */}
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("dose.missed_guidance.contact_reminder")}</span>
          {showCorrection ? (
            <>
              <TextInput
                type="datetime-local"
                label={t("dose.correct.time_label")}
                value={correctionTime}
                onChange={(e) => setCorrectionTime(e.target.value)}
              />
              <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
                <Button
                  loading={busyAction === "taken_other_time"}
                  disabled={busy || !correctionTime}
                  onClick={() => void act("taken_other_time", undefined, new Date(correctionTime).toISOString())}
                >
                  {t("common.save")}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setShowCorrection(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          ) : (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setCorrectionTime(toDatetimeLocalValue(new Date()));
                setShowCorrection(true);
              }}
            >
              {t("dose.action.mark_taken")}
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
