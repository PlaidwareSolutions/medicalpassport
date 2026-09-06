"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, PillSpinner, SectionTitle, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { DoctorPicker } from "../../../components/DoctorPicker";
import { DocumentUploadButtons } from "../../../components/DocumentUploadButtons";
import { PageHeader } from "../../../components/PageHeader";
import { emptyLine, lineToInput, PrescriptionLineRow, type LineDraft } from "../../../components/PrescriptionLineEditor";
import { MAX_IMAGE_BYTES, uploadDocument } from "../../../lib/document-upload";
import { useI18n } from "../../../lib/i18n";
import { ensurePractitioner } from "../../../lib/practitioners";
import { createPrescription } from "../../../lib/prescriptions";

function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A calendar date typed into a date input, sent as the noon instant so no zone can move it a day. */
function dateOnlyToIso(date: string): string {
  return new Date(`${date}T12:00:00Z`).toISOString();
}

/**
 * Screen 43 (docs/07) + Phase 2 line items (docs_v2/06 P2-5): file a
 * prescription from a doctor visit — who, when, the diagnosis and dates as
 * written, the medicines as lines, and the paper itself as a photo/PDF.
 * Nothing is required: a patient who can't read the handwriting can still
 * file the photo and fill in the rest later. A line needs only a name.
 */
export default function NewPrescriptionPage() {
  const { t } = useI18n();
  const router = useRouter();

  const [practitionerName, setPractitionerName] = useState("");
  const [practitionerSpeciality, setPractitionerSpeciality] = useState("");
  const [prescribedAt, setPrescribedAt] = useState(() => toDateOnly(new Date()));
  const [diagnosis, setDiagnosis] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [followUpOn, setFollowUpOn] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "saving" | "uploading">("idle");
  const [error, setError] = useState<string | undefined>();
  // A failed upload leaves the record already created; retrying must reuse
  // it, not file a duplicate.
  const createdIdRef = useRef<string | undefined>(undefined);

  function pickFiles(picked: File[]) {
    setError(undefined);
    const valid = picked.filter((f) => f.size <= MAX_IMAGE_BYTES || f.type === "application/pdf");
    if (valid.length < picked.length) setError(t("scan.upload_error"));
    if (valid.length > 0) setFiles((prev) => [...prev, ...valid]);
  }

  const namedLines = lines.filter((l) => l.enteredName.trim().length > 0);

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      setStage("saving");
      await ensurePractitioner(practitionerName, practitionerSpeciality).catch(() => undefined);
      let prescriptionId = createdIdRef.current;
      if (!prescriptionId) {
        const prescription = await createPrescription({
          ...(practitionerName.trim() ? { practitionerName: practitionerName.trim() } : {}),
          ...(prescribedAt ? { prescribedAt: dateOnlyToIso(prescribedAt) } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(diagnosis.trim() ? { diagnosisText: diagnosis.trim() } : {}),
          ...(validUntil ? { validUntil: dateOnlyToIso(validUntil) } : {}),
          ...(followUpOn ? { followUpOn: dateOnlyToIso(followUpOn) } : {}),
          ...(namedLines.length > 0 ? { items: namedLines.map((l, i) => lineToInput(l, i + 1)) } : {}),
        });
        prescriptionId = prescription.id;
        createdIdRef.current = prescriptionId;
      }

      if (files.length > 0) {
        setStage("uploading");
        for (const file of files) await uploadDocument(file, { kind: "prescription", prescriptionId });
      }
      router.replace(`/prescriptions/${prescriptionId}`);
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("scan.upload_error"));
      setStage("idle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader title={t("prescriptions.new_title")} readAloud={[{ text: t("guide.screen.prescription_new") }]} />
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {busy ? (
        <Card>
          <PillSpinner label={stage === "uploading" ? t("scan.uploading") : t("common.loading")} />
        </Card>
      ) : (
        <>
          <Card>
            <DoctorPicker
              label={t("prescriptions.doctor_label")}
              value={practitionerName}
              onChange={(name, speciality) => {
                setPractitionerName(name);
                setPractitionerSpeciality(speciality ?? "");
              }}
            />
            <TextInput label={t("prescriptions.date_label")} type="date" value={prescribedAt} onChange={(e) => setPrescribedAt(e.target.value)} />
            <TextInput
              label={t("rx.diagnosis_label")}
              placeholder={t("rx.diagnosis_placeholder")}
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
            />
            <TextInput label={t("rx.valid_until_label")} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            <TextInput label={t("rx.follow_up_label")} type="date" value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} />
            <TextInput label={t("prescriptions.notes_label")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Card>

          <SectionTitle>{t("rx.lines_title")}</SectionTitle>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("rx.lines_help")}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {lines.map((line, i) => (
              <PrescriptionLineRow
                key={line.key}
                line={line}
                index={i}
                onChange={(next) => setLines((prev) => prev.map((l) => (l.key === line.key ? next : l)))}
                onRemove={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
              />
            ))}
            <Button variant="secondary" fullWidth onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              {t("rx.line_add")}
            </Button>
          </div>

          <div style={{ marginTop: "var(--space-md)" }}>
            <DocumentUploadButtons photoLabel={t("prescriptions.take_photo")} fileLabel={t("prescriptions.choose_file")} onPick={pickFiles} />
          </div>

          {files.length > 0 ? (
            <Card>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-sm)" }}>
                  <span style={{ fontSize: "var(--font-small)" }}>{f.name}</span>
                  <Button variant="ghost" onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))} aria-label={t("rx.file_remove")}>
                    ✕
                  </Button>
                </div>
              ))}
            </Card>
          ) : null}

          <div style={{ marginTop: "var(--space-lg)" }}>
            <Button fullWidth loading={busy} disabled={busy} onClick={() => void save()}>
              {t("prescriptions.save")}
            </Button>
          </div>
        </>
      )}
    </AppShell>
  );
}
