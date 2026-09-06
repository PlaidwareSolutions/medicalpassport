"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { Banner, Button, Card, ChoiceGrid, PillSpinner, SectionTitle } from "@medpass/ui-web";
import { AppShell } from "../../../components/AppShell";
import { DocumentUploadButtons } from "../../../components/DocumentUploadButtons";
import { GuideGlyph } from "../../../components/GuideGlyph";
import { PageHeader } from "../../../components/PageHeader";
import {
  CHOOSABLE_KINDS,
  MAX_DOCUMENT_PAGES,
  chooserKindFor,
  classificationBucket,
  completePage,
  createDocument,
  fetchDocument,
  isDocumentKind,
  kindLabelKey,
  pageContentTypeFor,
  pageTooLarge,
  updateDocument,
  uploadPageBytes,
  type ClassificationDto,
  type DocumentKind,
  type PageContentType,
  type SourceChannel,
} from "../../../lib/documents";
import { useI18n } from "../../../lib/i18n";
import { clearSharedFiles, readSharedFiles } from "../../../lib/share-target-inbox";

interface CapturedPage {
  key: string;
  file: File;
  contentType: PageContentType;
  previewUrl: string | null;
  channel: SourceChannel;
}

type Step = "capture" | "uploading" | "classifying" | "kind";

class QuarantinedError extends Error {}

const CLASSIFY_POLL_MS = 1500;
/** Tesseract on a phone-sized page takes a while; past this we stop waiting and simply ask. */
const CLASSIFY_TIMEOUT_MS = 90_000;

/**
 * Add a document (docs_v2/09 §10): capture pages → upload → "What is this?"
 * → hand over to review. Pages can be reordered and dropped before a single
 * byte is sent. The classifier's guess is shown with honest confidence
 * wording, but the *person's* tap is what sets the kind (docs_v2/09 §4):
 * `PATCH kind` is always sent, even when they agree with the guess, so the
 * classifier can never move it later. A discharge summary is routed to its
 * own explanation screen and never to "add medicines" (H-34).
 *
 * `?kind=` pre-selects the kind (the /add/scan hand-off); `?source=
 * share_target` drains the share-target inbox the service worker filled.
 */
function NewDocumentFlow() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetKind = chooserKindFor(searchParams.get("kind"));
  const fromShare = searchParams.get("source") === "share_target";

  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [step, setStep] = useState<Step>("capture");
  const [error, setError] = useState<string | undefined>();
  const [progress, setProgress] = useState({ page: 0, fraction: 0 });
  const [documentId, setDocumentId] = useState<string | undefined>();
  const [classification, setClassification] = useState<ClassificationDto | null>(null);
  const [classifyTimedOut, setClassifyTimedOut] = useState(false);
  const [chosenKind, setChosenKind] = useState<DocumentKind | undefined>(presetKind);
  const [saving, setSaving] = useState(false);
  const [approachingQuota, setApproachingQuota] = useState(false);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Shared files (H-38): the profile was chosen on /share-target; here they
  // become pages exactly like a gallery pick, and the inbox is emptied so a
  // later visit can never re-upload them.
  useEffect(() => {
    if (!fromShare) return;
    let cancelled = false;
    void readSharedFiles()
      .then((files) => {
        if (cancelled) return;
        addFiles(files, "share_target");
        return clearSharedFiles();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the hand-off
  }, [fromShare]);

  // Object URLs are revoked when the screen goes away.
  useEffect(() => {
    return () => {
      for (const p of pagesRef.current) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    };
  }, []);

  function addFiles(files: File[], channel: SourceChannel) {
    setError(undefined);
    const next: CapturedPage[] = [];
    let rejected = 0;
    for (const file of files) {
      const contentType = pageContentTypeFor(file);
      if (!contentType || pageTooLarge(file, contentType)) {
        rejected += 1;
        continue;
      }
      next.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        contentType,
        previewUrl: contentType === "application/pdf" ? null : URL.createObjectURL(file),
        channel,
      });
    }
    if (rejected > 0) setError(t("documents.file_rejected", { n: rejected }));
    setPages((prev) => [...prev, ...next].slice(0, MAX_DOCUMENT_PAGES));
  }

  function move(index: number, delta: number) {
    setPages((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item!);
      return copy;
    });
  }

  function remove(index: number) {
    setPages((prev) => {
      const gone = prev[index];
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function sourceChannelFor(list: CapturedPage[]): SourceChannel {
    // One channel per document: the share sheet or the camera when either
    // produced any page, else the gallery/file picker.
    if (list.some((p) => p.channel === "share_target")) return "share_target";
    if (list.some((p) => p.channel === "camera")) return "camera";
    return list.every((p) => p.contentType === "application/pdf") ? "file" : "gallery";
  }

  async function upload() {
    if (pages.length === 0) return;
    setStep("uploading");
    setError(undefined);
    setProgress({ page: 0, fraction: 0 });
    try {
      const created = await createDocument({
        ...(presetKind ? { kind: presetKind } : {}),
        sourceChannel: sourceChannelFor(pages),
        pages: pages.map((p) => ({ contentType: p.contentType, sizeBytes: p.file.size })),
      });
      setDocumentId(created.id);
      setApproachingQuota(created.approachingStorageQuota === true);
      for (const [index, page] of pages.entries()) {
        const authorization = created.pages[index];
        if (!authorization) throw new Error("upload_failed");
        setProgress({ page: index, fraction: 0 });
        await uploadPageBytes(authorization.uploadUrl, page.file, page.contentType, (fraction) => setProgress({ page: index, fraction }));
        await completePage(created.id, authorization.pageNumber);
      }
      setStep("classifying");
      await waitForClassification(created.id);
    } catch (err) {
      setStep("capture");
      setError(
        err instanceof QuarantinedError
          ? t("documents.quarantined")
          : err instanceof ApiError
            ? (err.problem.errors?.[0]?.message ?? err.problem.title)
            : t("scan.upload_error"),
      );
    }
  }

  async function waitForClassification(id: string) {
    const deadline = Date.now() + CLASSIFY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const doc = await fetchDocument(id);
      if (doc.status === "quarantined") throw new QuarantinedError();
      if (doc.classification.confidence !== null || doc.status === "processed" || doc.status === "failed") {
        setClassification(doc.classification);
        setChosenKind((prev) => prev ?? chooserKindFor(doc.classification.kind) ?? chooserKindFor(doc.kind));
        setStep("kind");
        return;
      }
      await new Promise((r) => setTimeout(r, CLASSIFY_POLL_MS));
    }
    setClassifyTimedOut(true);
    setStep("kind");
  }

  async function confirmKind() {
    if (!documentId || !chosenKind) return;
    setSaving(true);
    setError(undefined);
    try {
      await updateDocument(documentId, { kind: chosenKind });
      router.replace(chosenKind === "discharge_summary" ? `/documents/${documentId}/discharge` : `/documents/${documentId}/review`);
    } catch (err) {
      setSaving(false);
      setError(err instanceof ApiError ? err.problem.title : t("common.error_generic"));
    }
  }

  const guessKind = chooserKindFor(classification?.kind);
  const guessBucket = classificationBucket(classification?.confidence);
  const guessLabel = guessKind ? t(kindLabelKey(guessKind)) : undefined;
  const guessSentence =
    guessKind && guessLabel && guessBucket === "high"
      ? t("documents.guess_high", { kind: guessLabel })
      : guessKind && guessLabel && guessBucket === "medium"
        ? t("documents.guess_medium", { kind: guessLabel })
        : t("documents.guess_low");

  const kindChoices = CHOOSABLE_KINDS.map((kind) => ({ value: kind, label: t(kindLabelKey(kind)) }));
  const overall = pages.length > 0 ? (progress.page + progress.fraction) / pages.length : 0;

  return (
    <AppShell>
      <PageHeader title={t("documents.new_title")} readAloud={[{ audio: "screen.documents_new" }]} />

      {error ? <Banner tone="danger">{error}</Banner> : null}
      {approachingQuota ? <Banner tone="warning">{t("scan.approaching_storage_quota")}</Banner> : null}

      {step === "capture" ? (
        <>
          <p style={{ color: "var(--color-text-muted)", margin: "0 0 var(--space-md)" }}>{t("documents.new_intro")}</p>

          {pages.length > 0 ? (
            <>
              <SectionTitle>{t("documents.pages_title", { n: pages.length })}</SectionTitle>
              <ol style={{ listStyle: "none", padding: 0, margin: "0 0 var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {pages.map((p, index) => (
                  <li key={p.key} data-testid="captured-page">
                    <Card>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                        {p.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- local object URL, never leaves the phone
                          <img src={p.previewUrl} alt="" style={{ width: 56, height: 72, objectFit: "cover", borderRadius: "var(--radius-sm)", flexShrink: 0 }} />
                        ) : (
                          <span style={{ color: "var(--color-primary)", flexShrink: 0 }}>
                            <GuideGlyph name="document" size="lg" />
                          </span>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>{t("documents.page_n", { n: index + 1 })}</strong>
                          <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", overflowWrap: "anywhere" }}>{p.file.name}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "var(--size-touch-gap)", flexWrap: "wrap" }}>
                        <Button variant="secondary" disabled={index === 0} aria-label={t("documents.move_up_label", { n: index + 1 })} onClick={() => move(index, -1)}>
                          {t("documents.move_up")}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={index === pages.length - 1}
                          aria-label={t("documents.move_down_label", { n: index + 1 })}
                          onClick={() => move(index, 1)}
                        >
                          {t("documents.move_down")}
                        </Button>
                        <Button variant="ghost" aria-label={t("documents.remove_page_label", { n: index + 1 })} onClick={() => remove(index)}>
                          {t("documents.remove_page")}
                        </Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ol>
            </>
          ) : null}

          <DocumentUploadButtons
            photoLabel={pages.length > 0 ? t("documents.add_another_photo") : t("scan.take_photo")}
            fileLabel={t("scan.choose_file")}
            disabled={pages.length >= MAX_DOCUMENT_PAGES}
            onPick={(files, channel) => addFiles(files, channel)}
          />

          <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <Button fullWidth disabled={pages.length === 0} onClick={() => void upload()}>
              {pages.length > 1 ? t("documents.upload_pages", { n: pages.length }) : t("documents.upload_page")}
            </Button>
            <Link href="/documents" style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
              {t("documents.back_to_list")}
            </Link>
          </div>
        </>
      ) : null}

      {step === "uploading" ? (
        <Card>
          <PillSpinner label={t("documents.uploading_page", { n: progress.page + 1, total: pages.length })} />
          <div
            role="progressbar"
            aria-label={t("documents.upload_progress_label")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(overall * 100)}
            style={{ height: 12, borderRadius: 6, background: "var(--color-primary-soft)", overflow: "hidden" }}
          >
            <div style={{ width: `${Math.round(overall * 100)}%`, height: "100%", background: "var(--color-primary)", transition: "width 200ms" }} />
          </div>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("documents.upload_keep_open")}</span>
        </Card>
      ) : null}

      {step === "classifying" ? (
        <Card>
          <PillSpinner label={t("documents.classifying")} />
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{t("scan.processing_hint")}</span>
        </Card>
      ) : null}

      {step === "kind" ? (
        <>
          <SectionTitle>{t("documents.what_is_this")}</SectionTitle>
          <Card tone={guessBucket === "high" ? "info" : undefined} data-testid="classifier-guess">
            <span>{classifyTimedOut ? t("documents.guess_timeout") : guessSentence}</span>
          </Card>
          <div style={{ height: "var(--space-md)" }} />
          <ChoiceGrid label={t("documents.kind_label")} columns={2} choices={kindChoices} value={chosenKind} onChange={(v) => setChosenKind(isDocumentKind(v) ? v : undefined)} />
          <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            <Button fullWidth disabled={!chosenKind || saving} loading={saving} onClick={() => void confirmKind()}>
              {chosenKind && chosenKind === guessKind ? t("documents.kind_confirm_yes") : t("documents.kind_confirm_continue")}
            </Button>
            {documentId ? (
              <Link href={`/documents/${documentId}`} style={{ textAlign: "center", color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>
                {t("documents.decide_later")}
              </Link>
            ) : null}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}

export default function NewDocumentPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <PillSpinner label="…" />
        </AppShell>
      }
    >
      <NewDocumentFlow />
    </Suspense>
  );
}
