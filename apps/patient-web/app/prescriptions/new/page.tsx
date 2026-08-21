"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { DoctorPicker } from "../../../components/DoctorPicker";
import { DocumentUploadButtons } from "../../../components/DocumentUploadButtons";
import { PageHeader } from "../../../components/PageHeader";
import { MAX_IMAGE_BYTES, uploadDocument } from "../../../lib/document-upload";
import { useI18n } from "../../../lib/i18n";
import { ensurePractitioner } from "../../../lib/practitioners";
import { createPrescription } from "../../../lib/prescriptions";

function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Screen 43 (docs/07): file a prescription from a doctor visit — who, when,
 * and the prescription itself as a photo/PDF. Every field is optional except
 * nothing: a patient who can't read the doctor's handwriting can still file
 * the photo and fill in the rest later.
 */
export default function NewPrescriptionPage() {
  const { t } = useI18n();
  const router = useRouter();

  const [practitionerName, setPractitionerName] = useState("");
  const [practitionerSpeciality, setPractitionerSpeciality] = useState("");
  const [prescribedAt, setPrescribedAt] = useState(() => toDateOnly(new Date()));
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<"idle" | "saving" | "uploading">("idle");
  const [error, setError] = useState<string | undefined>();
  // A failed upload leaves the record already created; retrying must reuse
  // it, not file a duplicate — the broken-CORS era left one orphaned
  // prescription per retry before this existed.
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
      let prescriptionId = createdIdRef.current;
      if (!prescriptionId) {
        const prescription = await createPrescription({
          ...(practitionerName.trim() ? { practitionerName: practitionerName.trim() } : {}),
          ...(prescribedAt ? { prescribedAt: new Date(prescribedAt).toISOString() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
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
      <PageHeader title={t("prescriptions.new_title")} />
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
            <div style={{ height: "var(--space-sm)" }} />
            <TextInput
              label={t("prescriptions.date_label")}
              type="date"
              value={prescribedAt}
              onChange={(e) => setPrescribedAt(e.target.value)}
            />
            <div style={{ height: "var(--space-sm)" }} />
            <TextInput label={t("prescriptions.notes_label")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Card>

          <div style={{ marginTop: "var(--space-md)" }}>
            <DocumentUploadButtons photoLabel={t("prescriptions.take_photo")} fileLabel={t("prescriptions.choose_file")} onPick={pickFiles} />
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
              {t("prescriptions.save")}
            </Button>
          </div>
        </>
      )}
    </AppShell>
  );
}
