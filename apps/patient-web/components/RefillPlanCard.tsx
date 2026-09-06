"use client";
import { useEffect, useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, SectionTitle, TextInput } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { putRefillPlan, trimDecimalString, useRefillPlan } from "../lib/refill-plan";
import { formatCalendarDate } from "../lib/patient-time";

/**
 * Refill plan editor (docs_v2/04 §4.1, docs_v2/06 P2-5): pack size + what's
 * on hand → the day the supply is projected to run out, as one plain
 * sentence built from the patient's own numbers. It is a projection, never
 * advice to buy (docs/02 principle 3): no "order now", no urgency colour.
 * `exists: false` shows an invitation to set the plan up.
 */
export function RefillPlanCard({ medicationId, unitLabel, onSaved }: { medicationId: string; unitLabel: string; onSaved?: () => Promise<void> }) {
  const { t } = useI18n();
  const { plan, error, reload } = useRefillPlan(medicationId);
  const [editing, setEditing] = useState(false);
  const [packSize, setPackSize] = useState("");
  const [onHand, setOnHand] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();

  useEffect(() => {
    if (!plan) return;
    setPackSize(trimDecimalString(plan.packSize));
    setOnHand(trimDecimalString(plan.quantityOnHand));
  }, [plan]);

  async function save() {
    setBusy(true);
    setSaveError(undefined);
    try {
      await putRefillPlan(medicationId, {
        packSize: packSize.trim() ? Number(packSize) : null,
        quantityOnHand: onHand.trim() ? Number(onHand) : null,
      });
      await reload();
      await onSaved?.();
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <>
      <TextInput label={t("refill.pack_size_label", { unit: unitLabel })} type="number" inputMode="numeric" min="1" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
      <TextInput label={t("refill.on_hand_label", { unit: unitLabel })} type="number" inputMode="numeric" min="0" value={onHand} onChange={(e) => setOnHand(e.target.value)} />
      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
        <Button fullWidth loading={busy} disabled={busy} onClick={() => void save()} style={{ flex: "1 1 60%" }}>
          {t("refill.save")}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)} style={{ flex: "1 1 30%" }}>
          {t("common.cancel")}
        </Button>
      </div>
    </>
  );

  return (
    <>
      <SectionTitle>{t("refill.title")}</SectionTitle>
      <Card data-testid="refill-plan">
        {error && !plan ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
        {saveError ? <Banner tone="danger">{saveError}</Banner> : null}
        {!plan ? (
          <span style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</span>
        ) : editing ? (
          form
        ) : !plan.exists ? (
          <>
            <span>{t("refill.setup_invitation")}</span>
            <Button variant="secondary" fullWidth onClick={() => setEditing(true)}>
              {t("refill.setup")}
            </Button>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-md)" }}>
              <Fact label={t("refill.pack_size")} value={plan.packSize ? `${trimDecimalString(plan.packSize)} ${unitLabel}` : "—"} />
              <Fact label={t("refill.on_hand")} value={plan.quantityOnHand ? `${trimDecimalString(plan.quantityOnHand)} ${unitLabel}` : "—"} />
            </div>
            <p style={{ margin: 0 }} data-testid="refill-projection">
              {plan.projectedRunOutOn && plan.dailyConsumption
                ? t("refill.projection", {
                    daily: trimDecimalString(plan.dailyConsumption),
                    unit: unitLabel,
                    date: formatCalendarDate(`${plan.projectedRunOutOn}T00:00:00Z`),
                  })
                : t("refill.projection_unavailable")}
            </p>
            <Button variant="secondary" fullWidth onClick={() => setEditing(true)}>
              {t("refill.edit")}
            </Button>
          </>
        )}
      </Card>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
      <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: "var(--font-large)" }}>{value}</span>
    </div>
  );
}
