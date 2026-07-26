"use client";
import { useState } from "react";
import type { RefillReminderDto } from "@medpass/api-client";
import { Button, Card, TextInput } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { dismissRefillReminder, markRefilled } from "../lib/refill-reminders";

/**
 * Screen 27: refill/completion reminder (docs/07) — a Home-screen card, not
 * a full separate screen, matching how due-now/missed/concerns are already
 * Home sections rather than dedicated pages. Estimates are always labeled
 * as estimates (acceptance criterion), and refill vs. course-completion
 * wording is kept visibly distinct even though both render from this same
 * card.
 */
export function RefillReminderCard({ reminder, onChanged }: { reminder: RefillReminderDto; onChanged: () => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [refillMode, setRefillMode] = useState(false);
  const [newQuantity, setNewQuantity] = useState("");

  async function dismiss() {
    setBusy(true);
    try {
      await dismissRefillReminder(reminder.notificationId);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function confirmRefill() {
    const quantity = Number(newQuantity);
    if (newQuantity.trim() === "" || Number.isNaN(quantity) || quantity < 0) return;
    setBusy(true);
    try {
      await markRefilled(reminder.patientMedicationId, reminder.rowVersion, quantity);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone={reminder.kind === "refill" ? "warning" : "info"}>
      <strong style={{ fontSize: "var(--font-large)" }}>{reminder.medicationName}</strong>
      <span style={{ color: "var(--color-text-muted)" }}>
        {reminder.kind === "refill" ? t("reminders.refill_title") : t("reminders.completion_title")}
      </span>

      {reminder.kind === "refill" && reminder.daysRemainingEstimate != null ? (
        <div style={{ fontSize: "var(--font-small)" }}>{t("reminders.days_remaining", { count: reminder.daysRemainingEstimate })}</div>
      ) : null}
      {reminder.estimatedDate ? (
        <div style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
          {t(reminder.kind === "refill" ? "reminders.estimated_runout" : "reminders.estimated_completion", { date: reminder.estimatedDate })}
        </div>
      ) : null}
      {reminder.prescriberName ? (
        <div style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
          {t("meds.prescribed_by", { name: reminder.prescriberName })}
        </div>
      ) : null}

      {refillMode ? (
        <>
          <TextInput
            label={t("reminders.new_quantity_label")}
            type="number"
            inputMode="numeric"
            value={newQuantity}
            onChange={(e) => setNewQuantity(e.target.value)}
          />
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button loading={busy} disabled={busy || newQuantity.trim() === ""} onClick={() => void confirmRefill()}>
              {t("reminders.save")}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setRefillMode(false)}>
              {t("common.back")}
            </Button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
          <Button disabled={busy} onClick={() => setRefillMode(true)}>
            {t("reminders.mark_refilled")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setRefillMode(true)}>
            {t("reminders.adjust_quantity")}
          </Button>
          <Button variant="ghost" loading={busy} disabled={busy} onClick={() => void dismiss()}>
            {t("reminders.dismiss")}
          </Button>
        </div>
      )}
    </Card>
  );
}
