"use client";
import { useState } from "react";
import { Banner, Button, Card, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { addBloodPressureReading, deleteBloodPressureReading, useBloodPressureReadings } from "../../lib/vitals";
import { useI18n } from "../../lib/i18n";
import { formatPatientDateTime, useActiveTimezone } from "../../lib/patient-time";

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Screen 46: home blood-pressure diary — the BP sibling of the blood-sugar readings tab. */
export default function BloodPressurePage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const { items, error, reload } = useBloodPressureReadings();
  const [showForm, setShowForm] = useState(false);
  const [measuredAt, setMeasuredAt] = useState(() => toDateTimeLocal(new Date()));
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | undefined>();

  async function save() {
    setBusy(true);
    try {
      await addBloodPressureReading({
        measuredAt: new Date(measuredAt).toISOString(),
        systolic: Number(systolic),
        diastolic: Number(diastolic),
        pulseBpm: pulse ? Number(pulse) : undefined,
        note: note || undefined,
      });
      setSystolic("");
      setDiastolic("");
      setPulse("");
      setNote("");
      setMeasuredAt(toDateTimeLocal(new Date()));
      setShowForm(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("bp.delete_confirm"))) return;
    setDeletingId(id);
    try {
      await deleteBloodPressureReading(id);
      await reload();
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("bp.title")} readAloud={[{ audio: "screen.blood_pressure" }]} />

      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <EmptyState glyph="drop" titleKey="bp.empty_title" bodyKey="bp.empty_body" audioId="empty.blood_pressure" />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((r) => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>
                    {r.systolic}/{r.diastolic} {t("bp.mmhg_unit")}
                  </strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {r.pulseBpm != null ? <>{t("bp.pulse_short", { value: String(r.pulseBpm) })} · </> : null}
                    {formatPatientDateTime(r.measuredAt, timezone)}
                  </div>
                  {r.note ? (
                    <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{r.note}</div>
                  ) : null}
                </div>
                <Button variant="danger" loading={deletingId === r.id} disabled={deletingId === r.id} onClick={() => void remove(r.id)}>
                  {t("bp.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          <TextInput label={t("bp.measured_at_label")} type="datetime-local" value={measuredAt} onChange={(e) => setMeasuredAt(e.target.value)} />
          <TextInput label={t("bp.systolic_label")} type="number" inputMode="numeric" value={systolic} onChange={(e) => setSystolic(e.target.value)} />
          <TextInput label={t("bp.diastolic_label")} type="number" inputMode="numeric" value={diastolic} onChange={(e) => setDiastolic(e.target.value)} />
          <TextInput label={t("bp.pulse_label")} type="number" inputMode="numeric" value={pulse} onChange={(e) => setPulse(e.target.value)} />
          <TextInput label={t("bp.note_label")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button
            fullWidth
            loading={busy}
            disabled={busy || systolic.trim().length === 0 || diastolic.trim().length === 0}
            onClick={() => void save()}
          >
            {t("bp.save_reading")}
          </Button>
        </Card>
      ) : (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("bp.add_reading")}
        </Button>
      )}
    </AppShell>
  );
}
