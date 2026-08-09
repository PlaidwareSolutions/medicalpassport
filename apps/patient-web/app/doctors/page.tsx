"use client";
import { useId, useState } from "react";
import { ApiError, type PractitionerDto } from "@medpass/api-client";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../components/AppShell";
import { PageHeader } from "../../components/PageHeader";
import { useI18n } from "../../lib/i18n";
import { deletePractitioner, mergePractitioner, updatePractitioner, usePractitioners } from "../../lib/practitioners";

/**
 * "My doctors" (docs/07 screen 43 follow-up): the one place the shared
 * doctor records behind every prescriber/doctor field can be renamed
 * (propagating to every linked medicine, prescription, and report at once),
 * merged when near-duplicate spellings crept in, or removed when unused.
 * Doctors are normally created from the entry forms' picker, not here —
 * this screen is maintenance, not a required registration step.
 */
export default function DoctorsPage() {
  const { t } = useI18n();
  const { items, error: loadError, reload } = usePractitioners();
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  return (
    <AppShell>
      <PageHeader title={t("doctors.title")} />
      {error || loadError ? <Banner tone="danger">{error ?? t("common.error_generic")}</Banner> : null}

      {!items ? (
        <Card>
          <PillSpinner label={t("common.loading")} />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p style={{ margin: 0, color: "var(--color-text-muted)" }}>{t("doctors.empty")}</p>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          {items.map((doctor) => (
            <DoctorRow
              key={doctor.id}
              doctor={doctor}
              others={items.filter((d) => d.id !== doctor.id)}
              expanded={expandedId === doctor.id}
              onToggle={() => {
                setError(undefined);
                setExpandedId(expandedId === doctor.id ? undefined : doctor.id);
              }}
              onDone={() => {
                setExpandedId(undefined);
                void reload();
              }}
              onError={setError}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function DoctorRow({
  doctor,
  others,
  expanded,
  onToggle,
  onDone,
  onError,
}: {
  doctor: PractitionerDto;
  others: PractitionerDto[];
  expanded: boolean;
  onToggle: () => void;
  onDone: () => void;
  onError: (message: string | undefined) => void;
}) {
  const { t } = useI18n();
  const detailsId = useId();
  const [name, setName] = useState(doctor.displayName);
  const [speciality, setSpeciality] = useState(doctor.speciality ?? "");
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const usageCount = doctor.medicationCount + doctor.prescriptionCount + doctor.reportCount;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    onError(undefined);
    try {
      await action();
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "block",
          width: "100%",
        }}
      >
        <strong>{doctor.displayName}</strong>
        {doctor.speciality ? <div style={{ color: "var(--color-text-muted)" }}>{doctor.speciality}</div> : null}
        <div style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
          {t("doctors.usage", {
            medicines: doctor.medicationCount,
            prescriptions: doctor.prescriptionCount,
            reports: doctor.reportCount,
          })}
        </div>
      </button>

      {expanded ? (
        <div id={detailsId} style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
          <TextInput label={t("doctors.name_label")} value={name} onChange={(e) => setName(e.target.value)} />
          <TextInput
            label={t("doctors.speciality_label")}
            placeholder={t("doctors.speciality_placeholder")}
            value={speciality}
            onChange={(e) => setSpeciality(e.target.value)}
          />
          <Button
            fullWidth
            loading={busy}
            disabled={busy || !name.trim()}
            onClick={() => void run(() => updatePractitioner(doctor.id, { displayName: name.trim(), speciality: speciality.trim() }))}
          >
            {t("common.save")}
          </Button>

          {merging ? (
            <>
              <SectionTitle>{t("doctors.merge_into_label", { name: doctor.displayName })}</SectionTitle>
              <ChoiceGrid
                label={t("doctors.merge_into_label", { name: doctor.displayName })}
                columns={1}
                choices={others.map((d) => ({
                  value: d.id,
                  label: d.speciality ? `${d.displayName} — ${d.speciality}` : d.displayName,
                }))}
                value={mergeTarget}
                onChange={setMergeTarget}
              />
              <Button
                fullWidth
                variant="danger"
                loading={busy}
                disabled={busy || !mergeTarget}
                onClick={() => void run(() => mergePractitioner(doctor.id, mergeTarget!))}
              >
                {t("doctors.merge_confirm")}
              </Button>
              <Button fullWidth variant="ghost" disabled={busy} onClick={() => setMerging(false)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <>
              {others.length > 0 ? (
                <Button fullWidth variant="secondary" disabled={busy} onClick={() => setMerging(true)}>
                  {t("doctors.merge_action")}
                </Button>
              ) : null}
              {usageCount === 0 ? (
                <Button
                  fullWidth
                  variant="danger"
                  loading={busy}
                  disabled={busy}
                  onClick={() => void run(() => deletePractitioner(doctor.id))}
                >
                  {t("doctors.delete_action")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}
