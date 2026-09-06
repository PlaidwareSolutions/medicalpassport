"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { DIAGNOSTIC_REPORT_KINDS, IMAGING_MODALITIES, type DiagnosticReportKind, type ImagingModality } from "@medpass/domain";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { ClinicPicker, ensureOrganization, type ClinicSelection } from "../../../components/ClinicPicker";
import { DoctorPicker } from "../../../components/DoctorPicker";
import { DocumentUploadButtons } from "../../../components/DocumentUploadButtons";
import { PageHeader } from "../../../components/PageHeader";
import { emptyResult, ResultRowEditor, resultIsComplete, resultToInput, type ResultDraft } from "../../../components/ResultRowEditor";
import { organizations } from "../../../lib/clinical-profile";
import { addDiagnosticResult, createDiagnosticReport, isImagingKind, useAnalyteTerminology } from "../../../lib/diagnostics";
import { attachPagesToRecord } from "../../../lib/documents";
import { useI18n } from "../../../lib/i18n";
import { ensurePractitioner } from "../../../lib/practitioners";

function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A calendar date typed into a date input, sent as the noon instant so no zone can move it a day. */
function dateOnlyToIso(date: string): string {
  return new Date(`${date}T12:00:00Z`).toISOString();
}

/**
 * Structured report entry (docs_v2/06 P4-4): kind, dates, the lab from the
 * patient's own places, the doctor who ordered it, then either result rows
 * (labs) or the imaging fields (modality, body site, impression, findings).
 * Only the kind and a name are required. Values are stored as typed; the
 * unit is a tap from the analyte's own allowed list (H-35).
 */
export default function NewDiagnosticReportPage() {
  const { t } = useI18n();
  const router = useRouter();
  const { items: clinics } = organizations.useList();
  const { analytes } = useAnalyteTerminology();

  const [kind, setKind] = useState<DiagnosticReportKind>("laboratory");
  const [title, setTitle] = useState("");
  const [testedAt, setTestedAt] = useState(() => toDateOnly(new Date()));
  const [reportedAt, setReportedAt] = useState("");
  const [clinic, setClinic] = useState<ClinicSelection>({});
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");
  const [modality, setModality] = useState<ImagingModality | undefined>();
  const [bodySite, setBodySite] = useState("");
  const [impression, setImpression] = useState("");
  const [findings, setFindings] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [results, setResults] = useState<ResultDraft[]>([]);
  // Photos of the paper report, filed as one document linked to the report
  // once it exists (the V1 "take a photo" affordance on the V2 model).
  const [files, setFiles] = useState<Array<{ file: File; channel: "camera" | "gallery" }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // A failed result write leaves the report already created; retrying must
  // reuse it (and skip rows already saved), not file a duplicate.
  const createdIdRef = useRef<string | undefined>(undefined);
  const savedRowsRef = useRef<Set<string>>(new Set());

  const imaging = isImagingKind(kind);
  const complete = results.filter(resultIsComplete);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      let reportId = createdIdRef.current;
      if (!reportId) {
        const [organizationId] = await Promise.all([ensureOrganization(clinic), ensurePractitioner(doctorName, doctorSpeciality).catch(() => undefined)]);
        const facilityName = organizationId ? (clinics ?? []).find((c) => c.id === organizationId)?.displayName ?? clinic.newClinic?.displayName : undefined;
        const created = await createDiagnosticReport({
          kind,
          title: title.trim() || t(`dx.kind.${kind}` as never),
          ...(testedAt ? { testedAt: dateOnlyToIso(testedAt) } : {}),
          ...(reportedAt ? { reportedAt: dateOnlyToIso(reportedAt) } : {}),
          ...(organizationId ? { organizationId } : {}),
          ...(facilityName ? { facilityNameText: facilityName } : {}),
          ...(doctorName.trim() ? { orderingPractitionerName: doctorName.trim() } : {}),
          ...(imaging && modality ? { modality } : {}),
          ...(imaging && bodySite.trim() ? { bodySite: bodySite.trim() } : {}),
          ...(imaging && impression.trim() ? { impressionText: impression.trim() } : {}),
          ...(imaging && findings.trim() ? { findingsText: findings.trim() } : {}),
          ...(conclusion.trim() ? { conclusionText: conclusion.trim() } : {}),
        });
        reportId = created.id;
        createdIdRef.current = reportId;
      }
      let sequence = 0;
      for (const row of complete) {
        sequence += 1;
        if (savedRowsRef.current.has(row.key)) continue;
        await addDiagnosticResult(reportId, resultToInput(row, sequence));
        savedRowsRef.current.add(row.key);
      }
      if (files.length > 0) {
        // Every page in one document; a retry after a failure re-runs only
        // this step because the report and results above are already saved.
        const channel = files.some((f) => f.channel === "camera") ? "camera" : "gallery";
        await attachPagesToRecord({ diagnosticReportId: reportId }, imaging ? "imaging_report" : "laboratory_report", files.map((f) => f.file), channel);
        setFiles([]);
      }
      router.replace(`/reports/${reportId}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("common.error_generic"));
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("reports.new_title")} readAloud={[{ audio: "screen.report_new" }]} />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {busy ? (
        <Card>
          <PillSpinner label={t("common.loading")} />
        </Card>
      ) : (
        <>
          <Card>
            <ChoiceGrid
              label={t("reports.kind_label")}
              choices={DIAGNOSTIC_REPORT_KINDS.map((k) => ({ value: k, label: t(`dx.kind.${k}` as never) }))}
              value={kind}
              onChange={setKind}
            />
          </Card>

          <Card>
            <TextInput label={t("dx.title_label")} placeholder={t("dx.title_placeholder")} value={title} onChange={(e) => setTitle(e.target.value)} />
            <TextInput label={t("reports.date_label")} type="date" value={testedAt} onChange={(e) => setTestedAt(e.target.value)} />
            <TextInput label={t("dx.reported_at_label")} type="date" value={reportedAt} onChange={(e) => setReportedAt(e.target.value)} />
            <ClinicPicker label={t("dx.lab_label")} items={clinics} value={clinic} onChange={setClinic} />
            <DoctorPicker
              label={t("reports.doctor_label")}
              value={doctorName}
              onChange={(name, speciality) => {
                setDoctorName(name);
                setDoctorSpeciality(speciality ?? "");
              }}
            />
          </Card>

          {imaging ? (
            <Card>
              <ChoiceGrid
                label={t("dx.modality_label")}
                columns={2}
                choices={IMAGING_MODALITIES.map((m) => ({ value: m, label: t(`dx.modality.${m}` as never) }))}
                value={modality}
                onChange={setModality}
              />
              <TextInput label={t("dx.body_site_label")} placeholder={t("dx.body_site_placeholder")} value={bodySite} onChange={(e) => setBodySite(e.target.value)} />
              <TextInput label={t("dx.impression_label")} help={t("dx.copied_help")} value={impression} onChange={(e) => setImpression(e.target.value)} />
              <TextInput label={t("dx.findings_label")} help={t("dx.copied_help")} value={findings} onChange={(e) => setFindings(e.target.value)} />
            </Card>
          ) : (
            <>
              <SectionTitle>{t("dx.results_title")}</SectionTitle>
              <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("dx.results_help")}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {results.map((row, i) => (
                  <Card key={row.key}>
                    <ResultRowEditor
                      draft={row}
                      index={i}
                      analytes={analytes}
                      onChange={(next) => setResults((prev) => prev.map((r) => (r.key === row.key ? next : r)))}
                      onRemove={() => setResults((prev) => prev.filter((r) => r.key !== row.key))}
                    />
                  </Card>
                ))}
                <Button variant="secondary" fullWidth onClick={() => setResults((prev) => [...prev, emptyResult()])}>
                  {t("dx.result_add")}
                </Button>
              </div>
            </>
          )}

          <Card>
            <TextInput label={t("dx.conclusion_label")} help={t("dx.copied_help")} value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
          </Card>

          <div style={{ marginTop: "var(--space-md)" }}>
            <DocumentUploadButtons
              photoLabel={t("reports.take_photo")}
              fileLabel={t("reports.choose_file")}
              onPick={(picked, channel) => setFiles((prev) => [...prev, ...picked.map((file) => ({ file, channel }))])}
            />
          </div>
          {files.length > 0 ? (
            <Card>
              {files.map((f, i) => (
                <div key={`${f.file.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
                  <span style={{ fontSize: "var(--font-small)" }}>{f.file.name}</span>
                  <Button variant="ghost" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label={t("rx.file_remove")}>
                    ×
                  </Button>
                </div>
              ))}
            </Card>
          ) : null}

          <div style={{ marginTop: "var(--space-lg)" }}>
            <Button fullWidth loading={busy} disabled={busy} onClick={() => void save()}>
              {t("reports.save")}
            </Button>
          </div>
        </>
      )}
    </AppShell>
  );
}
