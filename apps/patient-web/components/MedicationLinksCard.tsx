"use client";
import { useState } from "react";
import Link from "next/link";
import { ApiError, type PatientMedicationDto } from "@medpass/api-client";
import { Banner, Button, Card, SectionTitle, TextInput } from "@medpass/ui-web";
import { api, getActiveProfileId } from "../lib/api";
import { useSharedResource } from "../lib/data-cache";
import { useI18n } from "../lib/i18n";
import { medicationChangeSentence } from "../lib/medication-changes";
import { medicationLinks, updateMedicationLinks } from "../lib/medications";
import { formatCalendarDate, formatPatientDateTime, patientLocalToIso, useActiveTimezone } from "../lib/patient-time";
import { createPractitioner, usePractitioners } from "../lib/practitioners";
import { ConditionPicker } from "./ConditionPicker";
import { DoctorPicker } from "./DoctorPicker";

interface MedicationChangeDto {
  id: string;
  change: string;
  detail: Record<string, unknown> | null;
  occurredAt: string;
}

function useMedicationHistory(id: string) {
  const path = `/medications/${id}/history`;
  const { data, error } = useSharedResource<MedicationChangeDto[]>({
    path,
    fetcher: async () => (await api.get<{ items: MedicationChangeDto[] }>(path, { profileId: getActiveProfileId() })).items,
  });
  return { changes: data, error };
}

/**
 * "Why · who · since when · changes" (docs_v2/06 P2-5, docs_v2/04 §4.1):
 * the reason as a link to the patient's own condition, the prescribing
 * doctor from the shared directory, the start date and a planned stop
 * date, and the medicine's own change history. Facts the patient recorded
 * about their medicine — never a judgement about it.
 */
export function MedicationLinksCard({ medication, onSaved }: { medication: PatientMedicationDto; onSaved: () => Promise<void> }) {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const links = medicationLinks(medication);
  const { items: practitioners } = usePractitioners();
  const { changes } = useMedicationHistory(medication.id);

  const [editing, setEditing] = useState(false);
  const [conditionId, setConditionId] = useState<string | null>(links.reasonCondition?.id ?? null);
  const [doctorName, setDoctorName] = useState(links.prescribingPractitioner?.displayName ?? "");
  const [doctorSpeciality, setDoctorSpeciality] = useState<string | undefined>();
  const [stopPlanned, setStopPlanned] = useState((links.stopPlannedAt ?? "").slice(0, 10));
  // The API writes stopPlannedAt but its detail DTO doesn't echo it back yet;
  // the saved value is kept here so the screen stays truthful after a save.
  const [savedStop, setSavedStop] = useState<string | null>(links.stopPlannedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function resolvePractitionerId(): Promise<string | null> {
    const name = doctorName.trim();
    if (!name) return null;
    const existing = (practitioners ?? []).find((p) => p.displayName.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const created = await createPractitioner({ displayName: name, ...(doctorSpeciality?.trim() ? { speciality: doctorSpeciality.trim() } : {}) });
    return created.id;
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const practitionerId = await resolvePractitionerId();
      const stopIso = stopPlanned ? patientLocalToIso(`${stopPlanned}T12:00`, timezone) : null;
      await updateMedicationLinks(medication, {
        reasonConditionId: conditionId,
        prescribingPractitionerId: practitionerId,
        stopPlannedAt: stopIso,
      });
      setSavedStop(stopIso);
      await onSaved();
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const doctorLabel = links.prescribingPractitioner?.displayName ?? medication.prescriberName;

  return (
    <>
      <SectionTitle>{t("medlinks.title")}</SectionTitle>
      <Card data-testid="medication-links">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {editing ? (
          <>
            <ConditionPicker label={t("medlinks.why_label")} value={conditionId} onChange={setConditionId} />
            <DoctorPicker
              label={t("medlinks.who_label")}
              value={doctorName}
              onChange={(name, speciality) => {
                setDoctorName(name);
                setDoctorSpeciality(speciality);
              }}
            />
            <TextInput
              label={t("medlinks.stop_planned_label")}
              help={t("medlinks.stop_planned_help")}
              type="date"
              value={stopPlanned}
              onChange={(e) => setStopPlanned(e.target.value)}
            />
            <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
              <Button fullWidth loading={busy} disabled={busy} onClick={() => void save()} style={{ flex: "1 1 60%" }}>
                {t("common.save")}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)} style={{ flex: "1 1 30%" }}>
                {t("common.cancel")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Fact label={t("medlinks.why")}>
              {links.reasonCondition ? (
                <Link href="/conditions" style={{ color: "var(--color-info)", textDecoration: "underline" }}>
                  {links.reasonCondition.label}
                </Link>
              ) : (
                <span style={{ color: "var(--color-text-muted)" }}>{t("medlinks.why_empty")}</span>
              )}
            </Fact>
            <Fact label={t("medlinks.who")}>
              {doctorLabel ? doctorLabel : <span style={{ color: "var(--color-text-muted)" }}>{t("medlinks.who_empty")}</span>}
            </Fact>
            <Fact label={t("medlinks.since")}>
              {medication.startDate ? formatCalendarDate(medication.startDate) : t("medlinks.since_added", { date: formatCalendarDate(medication.createdAt) })}
            </Fact>
            <Fact label={t("medlinks.stop_planned")}>
              {savedStop ? formatCalendarDate(savedStop) : <span style={{ color: "var(--color-text-muted)" }}>{t("medlinks.stop_planned_empty")}</span>}
            </Fact>
            <Button variant="secondary" fullWidth onClick={() => setEditing(true)}>
              {t("medlinks.edit")}
            </Button>
          </>
        )}
      </Card>

      <SectionTitle>{t("medlinks.changes")}</SectionTitle>
      <Card>
        {changes === undefined ? (
          <span style={{ color: "var(--color-text-muted)" }}>{t("common.loading")}</span>
        ) : changes.length === 0 ? (
          <span style={{ color: "var(--color-text-muted)" }}>{t("medlinks.changes_empty")}</span>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: "1.2em", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            {changes.map((c) => (
              <li key={c.id}>
                <span>{changeSentence(t, c)}</span>
                <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{formatPatientDateTime(c.occurredAt, timezone)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <span style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)", fontWeight: 600 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** Shared with the visit summary so the same event never reads two ways. */
function changeSentence(t: (key: never, params?: Record<string, string | number>) => string, c: MedicationChangeDto): string {
  const to = (c.detail ?? {}).to;
  return medicationChangeSentence(t as never, c.change, typeof to === "string" ? to : null);
}
