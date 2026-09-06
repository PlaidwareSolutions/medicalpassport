"use client";
import { ApiError } from "@medpass/api-client";
import {
  clearDocumentIntent,
  dropDocumentPage,
  enqueueDocumentUploadIntent,
  getDocumentIntentProgress,
  listDocumentPages,
  setDocumentIntentProgress,
  type DocumentIntentProgress,
  type DocumentUploadIntentPayload,
  type OfflineMutation,
} from "@medpass/offline-sync";
import { getActiveProfileId, newIdempotencyKey } from "./api";
import {
  completePage,
  createDocument,
  invalidateDocumentData,
  processDocument,
  UploadError,
  uploadPageBytes,
  type DocumentKind,
  type DocumentLink,
  type PageContentType,
  type SourceChannel,
} from "./documents";
import { notifyMutationQueued } from "./offline";

/**
 * Documents captured offline (docs_v2/05 §14 `document_upload_intent`).
 *
 * The capture screen cannot send bytes with no connection, so it parks the
 * page files in IndexedDB (never a service-worker cache — PHI, docs/15)
 * together with the kind the person declared and the record it belongs to,
 * and queues one mutation. When the sync engine next flushes it calls
 * `replayDocumentUploadIntent`, which runs the SAME sequence the online
 * screen runs — create → presigned upload → complete → process — using the
 * clientMutationId as the create's Idempotency-Key and recording progress
 * after every page, so a second interruption resumes rather than restarts
 * and never makes a second document. The mutation then goes to `/sync`
 * carrying the resulting `documentId` as the fulfilment record.
 */

export interface CapturedPageFile {
  file: File;
  contentType: PageContentType;
}

export interface QueueDocumentIntentInput {
  /** Reuse the key an online attempt already used with the server, so a resume finds its document. */
  clientMutationId?: string;
  kind?: DocumentKind;
  title?: string;
  sourceChannel: SourceChannel;
  links?: DocumentLink;
  pages: CapturedPageFile[];
  /** Set when an online attempt got this far before the connection dropped. */
  documentId?: string;
  completedPages?: number[];
}

export async function queueDocumentUploadIntent(input: QueueDocumentIntentInput): Promise<{ clientMutationId: string }> {
  const profileId = getActiveProfileId();
  if (!profileId) throw new Error("no_active_profile");
  const clientMutationId = input.clientMutationId ?? newIdempotencyKey();

  const bytes = await Promise.all(
    input.pages.map(async (page, index) => ({
      pageNumber: index + 1,
      contentType: page.contentType,
      name: page.file.name,
      bytes: await page.file.arrayBuffer(),
    })),
  );
  const payload: DocumentUploadIntentPayload = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.title ? { title: input.title } : {}),
    sourceChannel: input.sourceChannel,
    pages: input.pages.map((page, index) => ({ pageNumber: index + 1, contentType: page.contentType, sizeBytes: page.file.size })),
    ...(input.links ?? {}),
  };
  await enqueueDocumentUploadIntent(
    { clientMutationId, entity: "document_upload_intent", operation: "create", payload, capturedAt: new Date().toISOString(), profileId },
    bytes,
    { documentId: input.documentId, completedPages: input.completedPages ?? [] },
  );
  notifyMutationQueued();
  return { clientMutationId };
}

/** Why a replay stopped: `network` means try again later; `rejected` means the server refused and retrying cannot help. */
export class DocumentReplayError extends Error {
  constructor(
    readonly reason: "network" | "rejected",
    readonly detail?: string,
  ) {
    super(`document_replay_${reason}`);
    this.name = "DocumentReplayError";
  }
}

/** Transient — retry later. A 4xx is the server's considered answer; a 5xx, like no answer at all, is not. */
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500;
  if (err instanceof UploadError) return err.reason === "network";
  return true;
}

/**
 * Runs (or resumes) the upload sequence for one queued intent. Progress is
 * persisted after the create and after every completed page; `onProgress`
 * mirrors it to the pending screen. Resolves with the document id once
 * every page is complete and processing is queued.
 */
export async function replayDocumentUploadIntent(
  mutation: OfflineMutation<DocumentUploadIntentPayload>,
  onProgress?: (progress: DocumentIntentProgress) => void,
): Promise<{ documentId: string }> {
  const { clientMutationId, profileId, payload } = mutation;
  let progress: DocumentIntentProgress = (await getDocumentIntentProgress(clientMutationId)) ?? {
    clientMutationId,
    profileId,
    completedPages: [],
    status: "queued",
    updatedAt: new Date().toISOString(),
  };
  const report = async (next: Partial<DocumentIntentProgress>) => {
    progress = { ...progress, ...next, updatedAt: new Date().toISOString() };
    await setDocumentIntentProgress(progress);
    onProgress?.(progress);
  };

  try {
    await report({ status: "uploading" });

    // The create body is rebuilt identically every time: the server's
    // idempotency ledger hashes it, and only an identical replay returns the
    // original document with its original page authorizations.
    const { pages, ...declaration } = payload;
    const created = await createDocument(
      { ...declaration, sourceChannel: declaration.sourceChannel as SourceChannel, kind: declaration.kind as DocumentKind | undefined, pages: pages.map((p) => ({ contentType: p.contentType as PageContentType, sizeBytes: p.sizeBytes })) },
      { idempotencyKey: clientMutationId, profileId },
    );
    if (progress.documentId && progress.documentId !== created.id) {
      // The ledger no longer knows this key (or answered another document):
      // the pages we already completed live on the first document, so keep
      // uploading there rather than splitting the capture across two.
      created.id = progress.documentId;
    }
    const documentId = created.id;
    if (!progress.documentId) await report({ documentId });

    const stored = await listDocumentPages(clientMutationId);
    for (const page of pages) {
      if (progress.completedPages.includes(page.pageNumber)) continue;
      const authorization = created.pages.find((a) => a.pageNumber === page.pageNumber);
      const bytes = stored.find((s) => s.pageNumber === page.pageNumber);
      if (!authorization || !bytes) throw new DocumentReplayError("rejected", "page_missing");
      await uploadPageBytes(authorization.uploadUrl, new Blob([bytes.bytes], { type: page.contentType }), page.contentType as PageContentType, () => undefined);
      await completePage(documentId, page.pageNumber, profileId);
      await dropDocumentPage(clientMutationId, page.pageNumber);
      await report({ completedPages: [...progress.completedPages, page.pageNumber] });
    }

    await processDocument(documentId, profileId);
    invalidateDocumentData();
    return { documentId };
  } catch (err) {
    if (err instanceof DocumentReplayError) {
      await report({ status: "failed" });
      throw err;
    }
    if (isNetworkFailure(err)) {
      await report({ status: "queued" });
      throw new DocumentReplayError("network");
    }
    await report({ status: "failed" });
    throw new DocumentReplayError("rejected", err instanceof ApiError ? err.problem.code : String(err));
  }
}

/** Everything the phone still holds for an intent that will never be sent (parked as a conflict, or dismissed). */
export async function discardDocumentUploadIntent(clientMutationId: string): Promise<void> {
  await clearDocumentIntent(clientMutationId);
}
