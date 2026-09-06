"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, Chip, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../../components/AppShell";
import { PageHeader } from "../../../../components/PageHeader";
import { TrustBadge } from "../../../../components/TrustBadge";
import { deleteEncounter, encounterDoctor, encounterPlace, useEncounter } from "../../../../lib/encounters";
import { useI18n } from "../../../../lib/i18n";
import { formatCalendarDate, formatPatientDateTime, useActiveTimezone } from "../../../../lib/patient-time";

/**
 * One visit (docs_v2/06 P1-4, docs_v2/10 H-31): what, when, where, with
 * whom — and everything explicitly linked to it (prescriptions, reports,
 * conditions, procedures), each a link to its own screen where one exists.
 */
export default function VisitDetailPage() {
  const { t } = useI18n();
  const timezone = useActiveTimezone();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { encounter, error } = useEncounter(params.id);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();

  async function remove() {
    if (!window.confirm(t("encounter.delete_confirm"))) return;
    setBusy(true);
    setActionError(undefined);
    try {
      await deleteEncounter(params.id);
      router.replace("/health/visits");
    } catch (err) {
      setActionError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
      setBusy(false);
    }
  }

  const prescriptions = encounter?.prescriptions ?? [];
  const reports = encounter?.medicalReports ?? [];
  const conditions = encounter?.conditions ?? [];
  const procedures = encounter?.procedures ?? [];
  const nothingLinked = prescriptions.length + reports.length + conditions.length + procedures.length === 0;

  return (
    <AppShell>
      <PageHeader
        title={encounter ? t(`encounter.kind.${encounter.kind}` as never) : t("encounter.detail_title")}
        right={encounter ? <TrustBadge verification={encounter.verification} provenanceSource={encounter.provenanceSource} /> : undefined}
      />
      {error ? <Banner tone="danger">{t("common.error_generic")}</Banner> : null}
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {!encounter && !error ? <PillSpinner label={t("common.loading")} /> : null}

      {encounter ? (
        <>
          <Card>
            <Row label={t("encounter.when_label")} value={formatPatientDateTime(encounter.startedAt, timezone)} />
            {encounter.endedAt ? <Row label={t("encounter.discharged_at_label")} value={formatPatientDateTime(encounter.endedAt, timezone)} /> : null}
            {encounterPlace(encounter) ? <Row label={t("encounter.clinic_label")} value={encounterPlace(encounter)!} /> : null}
            {encounterDoctor(encounter) ? <Row label={t("encounter.doctor_label")} value={encounterDoctor(encounter)!} /> : null}
            {encounter.reasonText ? <Row label={t("encounter.reason_label")} value={encounter.reasonText} /> : null}
            {encounter.diagnosisText ? <Row label={t("encounter.diagnosis_label")} value={encounter.diagnosisText} /> : null}
            {encounter.notes ? <Row label={t("encounter.notes_label")} value={encounter.notes} /> : null}
          </Card>

          <SectionTitle>{t("encounter.linked_title")}</SectionTitle>
          {nothingLinked ? (
            <Card tone="info">
              <span style={{ color: "var(--color-text-muted)" }}>{t("encounter.linked_empty")}</span>
            </Card>
          ) : null}

          {prescriptions.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {prescriptions.map((p) => (
                <Link key={p.id} href={`/prescriptions/${p.id}`}>
                  <Card>
                    <Chip>{t("profile.prescriptions")}</Chip>
                    <strong>{p.practitionerName || t("encounter.no_doctor")}</strong>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {p.prescribedAt ? formatCalendarDate(p.prescribedAt) : ""}
                    </span>
                  </Card>
                </Link>
              ))}
            </div>
          ) : null}

          {reports.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
              {reports.map((r) => (
                <Link key={r.id} href={`/reports/${r.id}`}>
                  <Card>
                    <Chip>{t("profile.reports")}</Chip>
                    <strong>{r.label || (r.kind ? t(`reports.kind.${r.kind}` as never) : t("profile.reports"))}</strong>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {r.testedAt ? formatCalendarDate(r.testedAt) : ""}
                    </span>
                  </Card>
                </Link>
              ))}
            </div>
          ) : null}

          {conditions.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
              {conditions.map((c) => (
                <Link key={c.id} href="/conditions">
                  <Card>
                    <Chip>{t("condition.title")}</Chip>
                    <strong>{c.label}</strong>
                    {c.clinicalStatus ? (
                      <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                        {t(`condition.status.${c.clinicalStatus}` as never)}
                      </span>
                    ) : null}
                  </Card>
                </Link>
              ))}
            </div>
          ) : null}

          {procedures.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-sm)" }}>
              {procedures.map((p) => (
                <Link key={p.id} href="/procedures">
                  <Card>
                    <Chip>{t("procedure.title")}</Chip>
                    <strong>{p.procedureText}</strong>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                      {p.performedOn ? formatCalendarDate(p.performedOn) : ""}
                    </span>
                  </Card>
                </Link>
              ))}
            </div>
          ) : null}

          <div style={{ marginTop: "var(--space-xl)" }}>
            <Button variant="danger" fullWidth loading={busy} disabled={busy} onClick={() => void remove()}>
              {t("encounter.delete")}
            </Button>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}
