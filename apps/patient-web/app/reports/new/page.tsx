"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type AuthorizeUploadResponseDto } from "@medpass/api-client";
import { MEDICAL_REPORT_KINDS, type MedicalReportKind } from "@medpass/domain";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { DoctorPicker } from "../../../components/DoctorPicker";
import { PageHeader } from "../../../components/PageHeader";
import { api, getActiveProfileId, newIdempotencyKey } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import { ensurePractitioner } from "../../../lib/practitioners";
import { createReport } from "../../../lib/reports";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Imaging and scan reports get the scan document kind; everything else is a lab result. */
function documentKindFor(kind: MedicalReportKind): "scan_report" | "lab_report" {
  return kind === "imaging" || kind === "ecg" ? "scan_report" : "lab_report";
}

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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function pickFile(f: File | undefined) {
    setError(undefined);
    if (!f) return;
    if (f.size > MAX_IMAGE_BYTES && f.type !== "application/pdf") {
      setError(t("scan.upload_error"));
      return;
    }
    setFiles((prev) => [...prev, f]);
  }

  async function uploadOne(file: File, reportId: string) {
    const contentType = file.type || "application/octet-stream";
    const authRes = await api.post<AuthorizeUploadResponseDto>(
      "/profiles/current/documents/authorize-upload",
      { kind: documentKindFor(kind), reportId, contentType, sizeBytes: file.size },
      { idempotencyKey: newIdempotencyKey(), profileId: getActiveProfileId() },
    );
    const putRes = await fetch(authRes.uploadUrl, { method: "PUT", headers: { "content-type": contentType }, body: file });
    if (!putRes.ok) throw new Error("upload_failed");
    await api.post(`/documents/${authRes.documentId}/complete`, undefined, { profileId: getActiveProfileId() });
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      setStage("saving");
      await ensurePractitioner(practitionerName, practitionerSpeciality).catch(() => undefined);
      const report = await createReport({
        kind,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(facilityName.trim() ? { facilityName: facilityName.trim() } : {}),
        ...(practitionerName.trim() ? { practitionerName: practitionerName.trim() } : {}),
        ...(testedAt ? { testedAt: new Date(testedAt).toISOString() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });

      if (files.length > 0) {
        setStage("uploading");
        for (const file of files) await uploadOne(file, report.id);
      }
      router.replace(`/reports/${report.id}`);
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

          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pickFile(e.target.files?.[0])} />

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
            <Button variant="secondary" fullWidth onClick={() => cameraInputRef.current?.click()}>
              📷 {t("reports.take_photo")}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => fileInputRef.current?.click()}>
              {t("reports.choose_file")}
            </Button>
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
