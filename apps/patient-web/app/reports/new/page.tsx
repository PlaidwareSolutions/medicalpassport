"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { MEDICAL_REPORT_KINDS, type MedicalReportKind } from "@medpass/domain";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { DoctorPicker } from "../../../components/DoctorPicker";
import { DocumentUploadButtons } from "../../../components/DocumentUploadButtons";
import { PageHeader } from "../../../components/PageHeader";
import { documentKindFor, MAX_IMAGE_BYTES, uploadDocument } from "../../../lib/document-upload";
import { useI18n } from "../../../lib/i18n";
import { ensurePractitioner } from "../../../lib/practitioners";
import { createReport } from "../../../lib/reports";

function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Screen 44 (docs/07): file a test report. Only the kind is required — a
 * patient who can't read the report should still be able to keep the photo
 * and fill in the rest later, or never. Individual analyte values are
 * deliberately not asked for; the document is the record.
 */
export default function NewReportPage() {
  const { t } = useI18n();
  const router = useRouter();

  const [kind, setKind] = useState<MedicalReportKind>("blood_test");
  const [label, setLabel] = useState("");
  const [facilityName, setFacilityName] = useState("");
  const [practitionerName, setPractitionerName] = useState("");
  const [practitionerSpeciality, setPractitionerSpeciality] = useState("");
  const [testedAt, setTestedAt] = useState(() => toDateOnly(new Date()));
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "saving" | "uploading">("idle");
  const [error, setError] = useState<string | undefined>();
  // Same retry rule as prescriptions/new: a failed upload leaves the record
  // already created; retrying must reuse it, not file a duplicate.
  const createdIdRef = useRef<string | undefined>(undefined);

  function pickFiles(picked: File[]) {
    setError(undefined);
    const valid = picked.filter((f) => f.size <= MAX_IMAGE_BYTES || f.type === "application/pdf");
    if (valid.length < picked.length) setError(t("scan.upload_error"));
    if (valid.length > 0) setFiles((prev) => [...prev, ...valid]);
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      setStage("saving");
      await ensurePractitioner(practitionerName, practitionerSpeciality).catch(() => undefined);
      let reportId = createdIdRef.current;
      if (!reportId) {
        const report = await createReport({
          kind,
          ...(label.trim() ? { label: label.trim() } : {}),
          ...(facilityName.trim() ? { facilityName: facilityName.trim() } : {}),
          ...(practitionerName.trim() ? { practitionerName: practitionerName.trim() } : {}),
          ...(testedAt ? { testedAt: new Date(testedAt).toISOString() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        });
        reportId = report.id;
        createdIdRef.current = reportId;
      }

      if (files.length > 0) {
        setStage("uploading");
        for (const file of files) await uploadDocument(file, { kind: documentKindFor(kind), reportId });
      }
      router.replace(`/reports/${reportId}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("scan.upload_error"));
      setStage("idle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("reports.new_title")} />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {busy ? (
        <Card>
          <PillSpinner label={stage === "uploading" ? t("scan.uploading") : t("common.loading")} />
        </Card>
      ) : (
        <>
          <Card>
            <ChoiceGrid
              label={t("reports.kind_label")}
              choices={MEDICAL_REPORT_KINDS.map((k) => ({ value: k, label: t(`reports.kind.${k}` as never) }))}
              value={kind}
              onChange={setKind}
            />
          </Card>

          <Card>
            <TextInput
              label={t("reports.label_label")}
              placeholder={t("reports.label_placeholder")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <div style={{ height: "var(--space-sm)" }} />
            <TextInput
              label={t("reports.facility_label")}
              placeholder={t("reports.facility_placeholder")}
              value={facilityName}
              onChange={(e) => setFacilityName(e.target.value)}
            />
            <div style={{ height: "var(--space-sm)" }} />
            <DoctorPicker
              label={t("reports.doctor_label")}
              value={practitionerName}
              onChange={(name, speciality) => {
                setPractitionerName(name);
                setPractitionerSpeciality(speciality ?? "");
              }}
            />
            <div style={{ height: "var(--space-sm)" }} />
            <TextInput label={t("reports.date_label")} type="date" value={testedAt} onChange={(e) => setTestedAt(e.target.value)} />
            <div style={{ height: "var(--space-sm)" }} />
            <TextInput
              label={t("reports.notes_label")}
              placeholder={t("reports.notes_placeholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Card>

          <div style={{ marginTop: "var(--space-md)" }}>
            <DocumentUploadButtons photoLabel={t("reports.take_photo")} fileLabel={t("reports.choose_file")} onPick={pickFiles} />
          </div>

          {files.length > 0 ? (
            <Card>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
                  <span style={{ fontSize: "var(--font-small)" }}>{f.name}</span>
                  <Button variant="ghost" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                    ✕
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
