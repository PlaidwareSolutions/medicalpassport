"use client";
import { useState } from "react";
import type { SafetyFindingDto } from "@medpass/api-client";
import { MANDATORY_WARNING_STATEMENT_KEYS } from "@medpass/clinical-rules";
import { Button, Card, Chip } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { formatPatientDate, useActiveTimezone } from "../lib/patient-time";
import { findingExplanationParams, recordFindingAction } from "../lib/safety";

const SEVERITY_TONE: Record<string, "default" | "warning" | "danger"> = {
  info: "default",
  low: "default",
  moderate: "warning",
  high: "danger",
};

const CARD_TONE: Record<string, "default" | "info" | "warning" | "danger"> = {
  info: "info",
  low: "info",
  moderate: "warning",
  high: "danger",
};

/**
 * Screens 22/23: duplicate-ingredient and allergy warnings (docs/07). Every
 * warning carries the four mandatory statements (docs/02) and never
 * disappears on acknowledgement — it stays visible with its new status.
 */
export function FindingCard({ finding, onChanged }: { finding: SafetyFindingDto; onChanged: () => void }) {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const [busy, setBusy] = useState(false);
  const params = findingExplanationParams(finding.detail);

  async function act(action: string) {
    setBusy(true);
    try {
      await recordFindingAction(finding.id, action);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone={CARD_TONE[finding.severity]}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "var(--space-sm)", flexWrap: "wrap" }}>
        <strong style={{ fontSize: "var(--font-large)", minWidth: 0 }}>{t(`safety.finding.${finding.category}` as never)}</strong>
        <Chip tone={SEVERITY_TONE[finding.severity]}>{t(`safety.severity.${finding.severity}` as never)}</Chip>
      </div>

      <p style={{ margin: 0 }}>{t(finding.explanationKey as never, params)}</p>

      <ul style={{ margin: 0, paddingInlineStart: "1.2em", fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
        {MANDATORY_WARNING_STATEMENT_KEYS.map((key) => (
          <li key={key}>{t(key as never)}</li>
        ))}
      </ul>

      <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
        {t("safety.evidence", { source: finding.sourceName, version: finding.ruleVersion })}
        {" · "}
        {t("safety.checked_at", { date: formatPatientDate(finding.evaluatedAt, timezone) })}
      </span>

      <Chip>{t(`safety.status.${finding.status}` as never)}</Chip>

      {finding.status === "open" ? (
        <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
          <Button disabled={busy} onClick={() => void act("acknowledged")}>
            {t("safety.action.acknowledge")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void act("reviewed_with_professional")}>
            {t("safety.action.mark_reviewed")}
          </Button>
        </div>
      ) : finding.status === "acknowledged" || finding.status === "reviewed_with_professional" ? (
        <Button variant="secondary" disabled={busy} onClick={() => void act("resolved")}>
          {t("safety.action.resolve")}
        </Button>
      ) : null}
    </Card>
  );
}
