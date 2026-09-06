"use client";
import { useState } from "react";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { TrustBadge } from "../../components/TrustBadge";
import { immunizations } from "../../lib/clinical-profile";
import { useI18n } from "../../lib/i18n";
import { formatCalendarDate } from "../../lib/patient-time";

const DOSES = ["1", "2", "3", "booster", "unknown"] as const;
const COMMON_VACCINES = ["covid19", "influenza", "tetanus", "hepatitis_b", "pneumococcal", "other"] as const;
type VaccineChoice = (typeof COMMON_VACCINES)[number];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Vaccinations (docs_v2/06 P1-4): common vaccines are a tap away; anything else is typed. */
export default function ImmunizationsPage() {
  const { t } = useI18n();
  const { items, error, reload } = immunizations.useList();
  const [showForm, setShowForm] = useState(false);
  const [choice, setChoice] = useState<VaccineChoice>("covid19");
  const [otherName, setOtherName] = useState("");
  const [dose, setDose] = useState<(typeof DOSES)[number]>("1");
  const [administeredOn, setAdministeredOn] = useState(today);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | undefined>();

  const vaccineText = choice === "other" ? otherName.trim() : t(`immunization.vaccine.${choice}` as never);

  async function save() {
    setBusy(true);
    setFormError(undefined);
    try {
      await immunizations.add({
        vaccineText,
        doseNumber: dose === "1" || dose === "2" || dose === "3" ? Number(dose) : null,
        administeredOn,
        notes: (dose === "booster" ? `${t("immunization.dose.booster")}${notes.trim() ? ` — ${notes.trim()}` : ""}` : notes.trim()) || null,
      });
      setShowForm(false);
      setOtherName("");
      setNotes("");
      setDose("1");
      setAdministeredOn(today());
      await reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("immunization.delete_confirm"))) return;
    setBusy(true);
    try {
      await immunizations.remove(id);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("immunization.title")} readAloud={[{ audio: "screen.immunizations" }]} />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {items === undefined && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {items && items.length === 0 && !showForm ? (
        <EmptyState glyph="syringe" titleKey="immunization.empty_title" bodyKey="immunization.empty_body" cta={{ labelKey: "immunization.add", onClick: () => setShowForm(true) }} />
      ) : null}

      {items && items.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((i) => (
            <Card key={i.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)", flexWrap: "wrap" }}>
                <strong>{i.vaccineText}</strong>
                {i.doseNumber ? <Chip>{t("immunization.dose_n", { n: i.doseNumber })}</Chip> : null}
              </div>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{formatCalendarDate(i.administeredOn)}</span>
              {i.notes ? <span style={{ fontSize: "var(--font-small)" }}>{i.notes}</span> : null}
              <div style={{ display: "flex", gap: "var(--size-touch-gap)", alignItems: "center", flexWrap: "wrap" }}>
                <TrustBadge verification={i.verification} provenanceSource={i.provenanceSource} />
                <span style={{ flex: 1 }} />
                <Button variant="danger" disabled={busy} onClick={() => void remove(i.id)}>
                  {t("immunization.delete")}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {showForm ? (
        <Card>
          {formError ? <Banner tone="danger">{formError}</Banner> : null}
          <ChoiceGrid
            label={t("immunization.vaccine_label")}
            columns={2}
            choices={COMMON_VACCINES.map((v) => ({ value: v, label: t(`immunization.vaccine.${v}` as never) }))}
            value={choice}
            onChange={setChoice}
          />
          {choice === "other" ? (
            <TextInput label={t("immunization.other_label")} placeholder={t("immunization.other_placeholder")} value={otherName} onChange={(e) => setOtherName(e.target.value)} />
          ) : null}
          <ChoiceGrid
            label={t("immunization.dose_label")}
            columns={3}
            choices={DOSES.map((d) => ({ value: d, label: t(`immunization.dose.${d}` as never) }))}
            value={dose}
            onChange={setDose}
          />
          <TextInput label={t("immunization.date_label")} type="date" max={today()} value={administeredOn} onChange={(e) => setAdministeredOn(e.target.value)} />
          <TextInput label={t("immunization.notes_label")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
            <Button loading={busy} disabled={busy || !vaccineText || !administeredOn} onClick={() => void save()}>
              {t("immunization.save")}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setShowForm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      ) : items && items.length > 0 ? (
        <Button fullWidth onClick={() => setShowForm(true)}>
          {t("immunization.add")}
        </Button>
      ) : null}
    </AppShell>
  );
}
