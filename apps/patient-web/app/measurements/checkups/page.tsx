"use client";
import { useState } from "react";
import { Banner, Button, Card, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { EmptyState } from "../../../components/EmptyState";
import { PageHeader } from "../../../components/PageHeader";
import {
  addCheckupRecord,
  deleteCheckupRecord,
  useCheckupRecords,
} from "../../../lib/blood-sugar";
import { useI18n } from "../../../lib/i18n";
import { formatCalendarDate } from "../../../lib/patient-time";


function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
        <EmptyState
          glyph="drop"
          titleKey="bloodsugar.checkups_empty_title"
          bodyKey="bloodsugar.checkups_empty_body"
          audioId="empty.bloodsugar_checkups"
        />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((c) => (
            <Card key={c.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{formatCalendarDate(c.checkupDate)}</strong>
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
                    {t("bloodsugar.next_appointment_label")}: {formatCalendarDate(c.nextAppointmentDate)}
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

/**
 * Periodic check-ups (docs/07 screen 42's second tab), moved here whole when
 * the daily-readings tab became the `/measurements/blood_glucose` diary
 * (docs_v2/06 P5-3). HbA1c, clinic BP/weight and the doctor's changes stay
 * their own record: they are visit facts, not home readings.
 */
export default function CheckupsPage() {
  const { t } = useI18n();
  return (
    <AppShell>
      <PageHeader title={t("bloodsugar.tab_checkups")} readAloud={[{ audio: "screen.checkups" }]} />
      <CheckupsTab />
    </AppShell>
  );
}
