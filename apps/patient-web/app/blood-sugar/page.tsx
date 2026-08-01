"use client";
import { useState } from "react";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, Tabs, TextInput } from "@medpass/ui-web";
import { GLUCOSE_READING_CONTEXTS, type GlucoseReadingContext } from "@medpass/domain";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import {
  addCheckupRecord,
  addGlucoseReading,
  deleteCheckupRecord,
  deleteGlucoseReading,
  useCheckupRecords,
  useGlucoseReadings,
} from "../../lib/blood-sugar";
import { useI18n } from "../../lib/i18n";

function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function ReadingsTab() {
  const { t } = useI18n();
  const { items, error, reload } = useGlucoseReadings();
  const [showForm, setShowForm] = useState(false);
  const [measuredAt, setMeasuredAt] = useState(() => toDateTimeLocal(new Date()));
  const [context, setContext] = useState<GlucoseReadingContext>("random");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | undefined>();

  async function save() {
    setBusy(true);
    try {
      await addGlucoseReading({
        measuredAt: new Date(measuredAt).toISOString(),
        context,
        valueMgDl: Number(value),
        note: note || undefined,
      });
      setValue("");
      setNote("");
      setContext("random");
      setMeasuredAt(toDateTimeLocal(new Date()));
      setShowForm(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("bloodsugar.delete_reading_confirm"))) return;
    setDeletingId(id);
    try {
      await deleteGlucoseReading(id);
      await reload();
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <>
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("bloodsugar.readings_empty")}</span>
        </Card>
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((r) => (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <strong>
                    {r.valueMgDl} {t("bloodsugar.mg_dl_unit")}
                  </strong>
                  <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                    {t(`bloodsugar.context.${r.context}` as never)} · {new Date(r.measuredAt).toLocaleString()}
                  </div>
                  {r.note ? (
                    <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{r.note}</div>
                  ) : null}
                </div>
                <Button variant="danger" loading={deletingId === r.id} disabled={deletingId === r.id} onClick={() => void remove(r.id)}>
                  {t("bloodsugar.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          <TextInput
            label={t("bloodsugar.measured_at_label")}
            type="datetime-local"
            value={measuredAt}
            onChange={(e) => setMeasuredAt(e.target.value)}
          />
          <ChoiceGrid
            label={t("bloodsugar.context_label")}
            value={context}
            onChange={setContext}
            columns={2}
            choices={GLUCOSE_READING_CONTEXTS.map((c) => ({ value: c, label: t(`bloodsugar.context.${c}` as never) }))}
          />
          <TextInput
            label={t("bloodsugar.value_label")}
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <TextInput label={t("bloodsugar.note_label")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button fullWidth loading={busy} disabled={busy || value.trim().length === 0} onClick={() => void save()}>
            {t("bloodsugar.save_reading")}
          </Button>
        </Card>
      ) : (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("bloodsugar.add_reading")}
        </Button>
      )}
    </>
  );
}

function CheckupsTab() {
  const { t } = useI18n();
  const { items, error, reload } = useCheckupRecords();
  const [showForm, setShowForm] = useState(false);
  const [checkupDate, setCheckupDate] = useState(() => toDateOnly(new Date()));
  const [fasting, setFasting] = useState("");
  const [postPrandial, setPostPrandial] = useState("");
  const [hba1c, setHba1c] = useState("");
  const [bpSystolic, setBpSystolic] = useState("");
  const [bpDiastolic, setBpDiastolic] = useState("");
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [cholesterol, setCholesterol] = useState("");
  const [treatmentChanges, setTreatmentChanges] = useState("");
  const [nextAppointment, setNextAppointment] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | undefined>();

  function reset() {
    setFasting("");
    setPostPrandial("");
    setHba1c("");
    setBpSystolic("");
    setBpDiastolic("");
    setWeight("");
    setWaist("");
    setCholesterol("");
    setTreatmentChanges("");
    setNextAppointment("");
    setCheckupDate(toDateOnly(new Date()));
  }

  async function save() {
    setBusy(true);
    try {
      await addCheckupRecord({
        checkupDate: new Date(checkupDate).toISOString(),
        fastingGlucoseMgDl: fasting ? Number(fasting) : undefined,
        postPrandialGlucoseMgDl: postPrandial ? Number(postPrandial) : undefined,
        hba1cPercent: hba1c ? Number(hba1c) : undefined,
        bloodPressureSystolic: bpSystolic ? Number(bpSystolic) : undefined,
        bloodPressureDiastolic: bpDiastolic ? Number(bpDiastolic) : undefined,
        weightKg: weight ? Number(weight) : undefined,
        waistCircumferenceCm: waist ? Number(waist) : undefined,
        cholesterolMgDl: cholesterol ? Number(cholesterol) : undefined,
        treatmentChanges: treatmentChanges || undefined,
        nextAppointmentDate: nextAppointment ? new Date(nextAppointment).toISOString() : undefined,
      });
      reset();
      setShowForm(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("bloodsugar.delete_checkup_confirm"))) return;
    setDeletingId(id);
    try {
      await deleteCheckupRecord(id);
      await reload();
    } finally {
      setDeletingId(undefined);
    }
  }

  return (
    <>
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <Card>
          <span style={{ color: "var(--color-text-muted)" }}>{t("bloodsugar.checkups_empty")}</span>
        </Card>
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((c) => (
            <Card key={c.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{new Date(c.checkupDate).toLocaleDateString()}</strong>
                <Button variant="danger" loading={deletingId === c.id} disabled={deletingId === c.id} onClick={() => void remove(c.id)}>
                  {t("bloodsugar.delete")}
                </Button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--font-small)", color: "var(--color-text-muted)", marginTop: "var(--space-xs)" }}>
                {c.fastingGlucoseMgDl != null ? <span>{t("bloodsugar.fasting_glucose_label")}: {c.fastingGlucoseMgDl}</span> : null}
                {c.postPrandialGlucoseMgDl != null ? <span>{t("bloodsugar.pp_glucose_label")}: {c.postPrandialGlucoseMgDl}</span> : null}
                {c.hba1cPercent != null ? <span>{t("bloodsugar.hba1c_label")}: {c.hba1cPercent}</span> : null}
                {c.bloodPressureSystolic != null && c.bloodPressureDiastolic != null ? (
                  <span>
                    {t("bloodsugar.bp_systolic_label")}/{t("bloodsugar.bp_diastolic_label")}: {c.bloodPressureSystolic}/{c.bloodPressureDiastolic}
                  </span>
                ) : null}
                {c.weightKg != null ? <span>{t("bloodsugar.weight_label")}: {c.weightKg}</span> : null}
                {c.waistCircumferenceCm != null ? <span>{t("bloodsugar.waist_label")}: {c.waistCircumferenceCm}</span> : null}
                {c.cholesterolMgDl != null ? <span>{t("bloodsugar.cholesterol_label")}: {c.cholesterolMgDl}</span> : null}
                {c.treatmentChanges ? <span>{t("bloodsugar.treatment_changes_label")}: {c.treatmentChanges}</span> : null}
                {c.nextAppointmentDate ? (
                  <span>
                    {t("bloodsugar.next_appointment_label")}: {new Date(c.nextAppointmentDate).toLocaleDateString()}
                  </span>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          <TextInput label={t("bloodsugar.checkup_date_label")} type="date" value={checkupDate} onChange={(e) => setCheckupDate(e.target.value)} />
          <TextInput label={t("bloodsugar.fasting_glucose_label")} type="number" inputMode="numeric" value={fasting} onChange={(e) => setFasting(e.target.value)} />
          <TextInput label={t("bloodsugar.pp_glucose_label")} type="number" inputMode="numeric" value={postPrandial} onChange={(e) => setPostPrandial(e.target.value)} />
          <TextInput label={t("bloodsugar.hba1c_label")} type="number" inputMode="decimal" value={hba1c} onChange={(e) => setHba1c(e.target.value)} />
          <TextInput label={t("bloodsugar.bp_systolic_label")} type="number" inputMode="numeric" value={bpSystolic} onChange={(e) => setBpSystolic(e.target.value)} />
          <TextInput label={t("bloodsugar.bp_diastolic_label")} type="number" inputMode="numeric" value={bpDiastolic} onChange={(e) => setBpDiastolic(e.target.value)} />
          <TextInput label={t("bloodsugar.weight_label")} type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <TextInput label={t("bloodsugar.waist_label")} type="number" inputMode="decimal" value={waist} onChange={(e) => setWaist(e.target.value)} />
          <TextInput label={t("bloodsugar.cholesterol_label")} type="number" inputMode="numeric" value={cholesterol} onChange={(e) => setCholesterol(e.target.value)} />
          <TextInput label={t("bloodsugar.treatment_changes_label")} value={treatmentChanges} onChange={(e) => setTreatmentChanges(e.target.value)} />
          <TextInput label={t("bloodsugar.next_appointment_label")} type="date" value={nextAppointment} onChange={(e) => setNextAppointment(e.target.value)} />
          <Button fullWidth loading={busy} disabled={busy || checkupDate.trim().length === 0} onClick={() => void save()}>
            {t("bloodsugar.save_checkup")}
          </Button>
        </Card>
      ) : (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("bloodsugar.add_checkup")}
        </Button>
      )}
    </>
  );
}

/** Screen 42 (docs/07): blood sugar monitoring diary — daily readings + periodic check-ups. */
export default function BloodSugarPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<"readings" | "checkups">("readings");

  return (
    <AppShell>
      <PageHeader title={t("bloodsugar.title")} />
      {/* Real tablist semantics (was a pair of plain Buttons with no
          role=tab/aria-selected) + reflow-safe wrapping (docs/33). */}
      <Tabs
        label={t("bloodsugar.title")}
        tabs={[
          { key: "readings", label: t("bloodsugar.tab_readings") },
          { key: "checkups", label: t("bloodsugar.tab_checkups") },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "readings" ? <ReadingsTab /> : <CheckupsTab />}
    </AppShell>
  );
}
