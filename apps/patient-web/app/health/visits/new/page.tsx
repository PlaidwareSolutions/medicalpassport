"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { ENCOUNTER_KINDS, type EncounterKind } from "@medpass/domain";
import { Banner, Button, Card, ChoiceGrid, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { ClinicPicker, ensureOrganization, type ClinicSelection } from "../../../../components/ClinicPicker";
import { DoctorPicker } from "../../../../components/DoctorPicker";
import { PageHeader } from "../../../../components/PageHeader";
import { organizations } from "../../../../lib/clinical-profile";
import { createEncounter } from "../../../../lib/encounters";
import { useI18n } from "../../../../lib/i18n";
import { patientLocalToIso, patientNowLocal, useActiveTimezone } from "../../../../lib/patient-time";
import { createPractitioner, usePractitioners } from "../../../../lib/practitioners";

/**
 * Record a visit (docs_v2/06 P1-4): kind, when (entered on the PATIENT's
 * clock, docs/16), where, with whom, and why. Pickers first, typing only
 * where a name is genuinely new (docs/18 minimal-typing rule).
 */
export default function NewVisitPage() {
  const { t } = useI18n();
  const router = useRouter();
  const timezone = useActiveTimezone();
  const { items: clinics } = organizations.useList();
  const { items: practitioners } = usePractitioners();

  const [kind, setKind] = useState<EncounterKind>("outpatient");
  const [startedAt, setStartedAt] = useState(() => patientNowLocal(timezone));
  const [endedAt, setEndedAt] = useState("");
  const [clinic, setClinic] = useState<ClinicSelection>({});
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState<string | undefined>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const isStay = kind === "inpatient";

  async function resolvePractitionerId(): Promise<string | undefined> {
    const name = doctorName.trim();
    if (!name) return undefined;
    const existing = (practitioners ?? []).find((p) => p.displayName.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const created = await createPractitioner({ displayName: name, ...(doctorSpeciality?.trim() ? { speciality: doctorSpeciality.trim() } : {}) });
    return created.id;
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const [organizationId, practitionerId] = await Promise.all([ensureOrganization(clinic), resolvePractitionerId()]);
      const created = await createEncounter({
        kind,
        startedAt: patientLocalToIso(startedAt, timezone),
        endedAt: isStay && endedAt ? patientLocalToIso(endedAt, timezone) : undefined,
        organizationId,
        practitionerId,
        reasonText: reason.trim() || undefined,
      });
      router.replace(`/health/visits/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("encounter.new_title")} />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Card>
        <ChoiceGrid
          label={t("encounter.kind_label")}
          columns={2}
          choices={ENCOUNTER_KINDS.map((k) => ({ value: k, label: t(`encounter.kind.${k}` as never) }))}
          value={kind}
          onChange={setKind}
        />
        <TextInput
          label={isStay ? t("encounter.admitted_at_label") : t("encounter.started_at_label")}
          help={t("encounter.time_help")}
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
        />
        {isStay ? (
          <TextInput label={t("encounter.discharged_at_label")} type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} />
        ) : null}
        <ClinicPicker label={t("encounter.clinic_label")} items={clinics} value={clinic} onChange={setClinic} />
        <DoctorPicker
          label={t("encounter.doctor_label")}
          value={doctorName}
          onChange={(name, speciality) => {
            setDoctorName(name);
            setDoctorSpeciality(speciality);
          }}
        />
        <TextInput
          label={t("encounter.reason_label")}
          placeholder={t("encounter.reason_placeholder")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button fullWidth loading={busy} disabled={busy || !startedAt} onClick={() => void save()}>
          {t("encounter.save")}
        </Button>
      </Card>
    </AppShell>
  );
}
