"use client";
import { useState } from "react";
import { Banner, Button, Card, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { addWeightReading, deleteWeightReading, useWeightReadings } from "../../lib/vitals";
import { useI18n } from "../../lib/i18n";
import { formatPatientDateTime, useActiveTimezone } from "../../lib/patient-time";

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Screen 47: body-weight diary — kg only, the unit check-ups already use. */
export default function BodyWeightPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items, error, reload } = useWeightReadings();
  const [showForm, setShowForm] = useState(false);
  const [measuredAt, setMeasuredAt] = useState(() => toDateTimeLocal(new Date()));
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | undefined>();

  async function save() {
    setBusy(true);
    try {
      await addWeightReading({
        measuredAt: new Date(measuredAt).toISOString(),
        weightKg: Number(weight),
        note: note || undefined,
      });
      setWeight("");
      setNote("");
      setMeasuredAt(toDateTimeLocal(new Date()));
      setShowForm(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("weight.delete_confirm"))) return;
    setDeletingId(id);
    try {
      await deleteWeightReading(id);
      await reload();
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("weight.title")} readAloud={[{ audio: "screen.body_weight" }]} />

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <EmptyState glyph="scale" titleKey="weight.empty_title" bodyKey="weight.empty_body" audioId="empty.body_weight" />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((r) => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>
                    {r.weightKg} {t("weight.kg_unit")}
                  </strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {formatPatientDateTime(r.measuredAt, timezone)}
                  </div>
                  {r.note ? (
                    <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{r.note}</div>
                  ) : null}
                </div>
                <Button variant="danger" loading={deletingId === r.id} disabled={deletingId === r.id} onClick={() => void remove(r.id)}>
                  {t("weight.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          <TextInput label={t("weight.measured_at_label")} type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
          <TextInput label={t("weight.value_label")} type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <TextInput label={t("weight.note_label")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button fullWidth loading={busy} disabled={busy || weight.trim().length === 0} onClick={() => void save()}>
            {t("weight.save_reading")}
          </Button>
        </Card>
      ) : (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("weight.add_reading")}
        </Button>
      )}
    </AppShell>
  );
}
