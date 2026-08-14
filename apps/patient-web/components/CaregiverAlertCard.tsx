"use client";
import type { CaregiverAlertDto } from "@medpass/api-client";
import { Card, Chip } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { formatPatientDateTime, useActiveTimezone } from "../lib/patient-time";

/**
 * A single missed-dose alert-history entry (docs/16 gap fix) — read-only:
 * resolution already happens automatically once the patient records the
 * dose, so there's nothing to act on here, unlike RefillReminderCard.
 */
export function CaregiverAlertCard({ alert }: { alert: CaregiverAlertDto }) {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const isOpen = alert.status === "missed";
  return (
    <Card tone={isOpen ? "danger" : "default"}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <strong style={{ minWidth: 0 }}>{alert.medicationName}</strong>
        <Chip tone={isOpen ? "danger" : "success"}>
          {isOpen ? t("alerts.status_missed") : t("alerts.status_resolved")}
        </Chip>
      </div>
      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
        {t("alerts.due_at", { time: formatPatientDateTime(alert.dueAt, timezone) })}
      </span>
    </Card>
  );
}
