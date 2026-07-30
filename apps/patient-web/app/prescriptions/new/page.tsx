"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type AuthorizeUploadResponseDto } from "@medpass/api-client";
import { Banner, Button, Card, PillSpinner, TextInput } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { api, getActiveProfileId, newIdempotencyKey } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";
import { createPrescription } from "../../../lib/prescriptions";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [practitionerName, setPractitionerName] = useState("");
  const [prescribedAt, setPrescribedAt] = useState(() => toDateOnly(new Date()));
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

  async function uploadOne(file: File, prescriptionId: string) {
    const contentType = file.type || "application/octet-stream";
    const authRes = await api.post<AuthorizeUploadResponseDto>(
      "/profiles/current/documents/authorize-upload",
      { kind: "prescription", prescriptionId, contentType, sizeBytes: file.size },
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
      const prescription = await createPrescription({
        ...(practitionerName.trim() ? { practitionerName: practitionerName.trim() } : {}),
        ...(prescribedAt ? { prescribedAt: new Date(prescribedAt).toISOString() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });

      if (files.length > 0) {
        setStage("uploading");
        for (const file of files) await uploadOne(file, prescription.id);
      }
      router.replace(`/prescriptions/${prescription.id}`);
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
            <TextInput
              label={t("prescriptions.doctor_label")}
              placeholder={t("prescriptions.doctor_placeholder")}
              value={practitionerName}
              onChange={(e) => setPractitionerName(e.target.value)}
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

          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pickFile(e.target.files?.[0])} />

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
            <Button variant="secondary" fullWidth onClick={() => cameraInputRef.current?.click()}>
              📷 {t("prescriptions.take_photo")}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => fileInputRef.current?.click()}>
              {t("prescriptions.choose_file")}
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
              {t("prescriptions.save")}
            </Button>
          </div>
        </>
      )}
    </AppShell>
  );
}
