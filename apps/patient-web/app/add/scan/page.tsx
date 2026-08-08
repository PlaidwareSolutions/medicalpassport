"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, type AuthorizeUploadResponseDto } from "@medpass/api-client";
import { Banner, Button, Card, ChoiceGrid, PillSpinner } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { PageHeader } from "../../../components/PageHeader";
import { api, getActiveProfileId, newIdempotencyKey } from "../../../lib/api";
import { useI18n } from "../../../lib/i18n";

type DocumentKind = "prescription" | "strip" | "box" | "bottle" | "discharge_summary" | "other";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Screen (Stage 3/8): capture or choose a prescription photo, upload it via
 * a presigned URL, and kick off OCR. Nothing is treated as fact here — the
 * next screen is where the patient confirms every detail (docs/09 §6).
 */
export default function ScanDocumentPage() {
  const { t } = useI18n();
  const router = useRouter();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<DocumentKind>("prescription");
  const [file, setFile] = useState<File | undefined>();
  const [stage, setStage] = useState<"idle" | "uploading" | "processing" | "error">("idle");
  const [error, setError] = useState<string | undefined>();
  const [approachingStorageQuota, setApproachingStorageQuota] = useState(false);

  function pickFile(f: File | undefined) {
    setError(undefined);
    if (f && f.size > MAX_IMAGE_BYTES && f.type !== "application/pdf") {
      setError(t("scan.upload_error"));
      return;
    }
    setFile(f);
  }

  async function upload() {
    if (!file) return;
    setStage("uploading");
    setError(undefined);
    try {
      const contentType = file.type || "application/octet-stream";
      const authRes = await api.post<AuthorizeUploadResponseDto>(
        "/profiles/current/documents/authorize-upload",
        { kind, contentType, sizeBytes: file.size },
        { idempotencyKey: newIdempotencyKey(), profileId: getActiveProfileId() },
      );
      setApproachingStorageQuota(authRes.approachingStorageQuota);

      const putRes = await fetch(authRes.uploadUrl, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: file,
      });
      if (!putRes.ok) throw new Error("upload_failed");

      await api.post(`/documents/${authRes.documentId}/complete`, undefined, {
        profileId: getActiveProfileId(),
      });

      setStage("processing");
      await api.post(`/documents/${authRes.documentId}/process`, undefined, {
        profileId: getActiveProfileId(),
      });

      router.replace(`/add/scan/${authRes.documentId}`);
    } catch (err) {
      setStage("error");
      setError(
        err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : t("scan.upload_error"),
      );
    }
  }

  const kindChoices: Array<{ value: DocumentKind; label: string }> = [
    { value: "prescription", label: t("scan.kind_prescription") },
    { value: "strip", label: t("scan.kind_strip") },
    { value: "box", label: t("scan.kind_box") },
    { value: "bottle", label: t("scan.kind_bottle") },
    { value: "discharge_summary", label: t("scan.kind_discharge_summary") },
    { value: "other", label: t("scan.kind_other") },
  ];

  const busy = stage === "uploading" || stage === "processing";

  return (
    <AppShell>
      <PageHeader title={t("scan.title")} readAloud={[{ audio: "screen.scan" }]} />
      <p style={{ color: "var(--color-text-muted)", marginBottom: "var(--space-md)" }}>{t("scan.intro")}</p>

      {error ? <Banner tone="danger">{error}</Banner> : null}

      {approachingStorageQuota ? <Banner tone="warning">{t("scan.approaching_storage_quota")}</Banner> : null}

      {busy ? (
        <Card>
          <PillSpinner label={stage === "uploading" ? t("scan.uploading") : t("scan.processing")} />
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
            {t("scan.processing_hint")}
          </span>
        </Card>
      ) : (
        <>
          <ChoiceGrid label={t("scan.kind_label")} columns={2} choices={kindChoices} value={kind} onChange={setKind} />

          <div style={{ height: "var(--space-md)" }} />

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => pickFile(e.target.files?.[0])}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <Button variant="secondary" fullWidth onClick={() => cameraInputRef.current?.click()}>
              📷 {t("scan.take_photo")}
            </Button>
            <Button variant="ghost" fullWidth onClick={() => fileInputRef.current?.click()}>
              {t("scan.choose_file")}
            </Button>
          </div>

          {file ? (
            <Card>
              <span>{t("scan.selected_file", { name: file.name })}</span>
            </Card>
          ) : null}

          <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <Button fullWidth disabled={!file} onClick={() => void upload()}>
              {t("scan.upload")}
            </Button>
            <Link href="/add" style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t("scan.add_manually")}
            </Link>
          </div>
        </>
      )}
    </AppShell>
  );
}
