import type { DocumentIntentProgress, DocumentUploadIntentPayload, OfflineMutation } from "./contract.js";
import { openOfflineDb, type StoredDocumentPage } from "./db.js";
import { enqueueMutation } from "./queue.js";

export interface CapturedPageBytes {
  pageNumber: number;
  contentType: string;
  name: string;
  bytes: ArrayBuffer;
}

/**
 * Queues a document captured offline (docs_v2/05 §14): the page bytes go to
 * IndexedDB first (never a service-worker cache — PHI, docs/15), then the
 * mutation itself, so a crash between the two leaves orphaned bytes (swept
 * by `clearDocumentIntent` on the next dismissal) rather than a mutation
 * whose pages are missing. Progress starts at `queued`.
 */
export async function enqueueDocumentUploadIntent(
  mutation: OfflineMutation<DocumentUploadIntentPayload>,
  pages: CapturedPageBytes[],
  progress: Pick<DocumentIntentProgress, "documentId" | "completedPages"> = { completedPages: [] },
): Promise<void> {
  if (pages.length !== mutation.payload.pages.length) {
    throw new Error("A document intent must carry bytes for exactly the pages it declares");
  }
  const db = await openOfflineDb();
  const tx = db.transaction(["documentPages", "documentIntents"], "readwrite");
  for (const page of pages) {
    const stored: StoredDocumentPage = {
      key: `${mutation.clientMutationId}:${page.pageNumber}`,
      clientMutationId: mutation.clientMutationId,
      profileId: mutation.profileId,
      pageNumber: page.pageNumber,
      contentType: page.contentType,
      sizeBytes: page.bytes.byteLength,
      name: page.name,
      bytes: page.bytes,
    };
    await tx.objectStore("documentPages").put(stored);
  }
  await tx.objectStore("documentIntents").put({
    clientMutationId: mutation.clientMutationId,
    profileId: mutation.profileId,
    documentId: progress.documentId,
    completedPages: [...progress.completedPages],
    status: "queued",
    updatedAt: new Date().toISOString(),
  });
  await tx.done;
  await enqueueMutation(mutation);
}

/** The stored pages of one intent, in page order. */
export async function listDocumentPages(clientMutationId: string): Promise<StoredDocumentPage[]> {
  const db = await openOfflineDb();
  const pages = await db.getAllFromIndex("documentPages", "by-mutation", clientMutationId);
  return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

export async function getDocumentIntentProgress(clientMutationId: string): Promise<DocumentIntentProgress | undefined> {
  const db = await openOfflineDb();
  return db.get("documentIntents", clientMutationId);
}

export async function listDocumentIntentProgress(profileId?: string): Promise<DocumentIntentProgress[]> {
  const db = await openOfflineDb();
  const all = await db.getAll("documentIntents");
  return profileId ? all.filter((p) => p.profileId === profileId) : all;
}

/** Replaces the progress record (a replay step just happened). */
export async function setDocumentIntentProgress(progress: DocumentIntentProgress): Promise<void> {
  const db = await openOfflineDb();
  await db.put("documentIntents", { ...progress, updatedAt: new Date().toISOString() });
}

/** A page is uploaded and complete on the server — its bytes are no longer needed on the phone. */
export async function dropDocumentPage(clientMutationId: string, pageNumber: number): Promise<void> {
  const db = await openOfflineDb();
  await db.delete("documentPages", `${clientMutationId}:${pageNumber}`);
}

/** Removes every trace of one intent's bytes and progress (the mutation row is the queue's business). */
export async function clearDocumentIntent(clientMutationId: string): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(["documentPages", "documentIntents"], "readwrite");
  const keys = await tx.objectStore("documentPages").index("by-mutation").getAllKeys(clientMutationId);
  for (const key of keys) await tx.objectStore("documentPages").delete(key);
  await tx.objectStore("documentIntents").delete(clientMutationId);
  await tx.done;
}

/** Bytes still waiting on the phone across every queued intent (the low-storage banner's input, never trimmed automatically). */
export async function pendingDocumentBytes(profileId?: string): Promise<number> {
  const db = await openOfflineDb();
  let total = 0;
  let cursor = await db.transaction("documentPages").store.openCursor();
  while (cursor) {
    if (!profileId || cursor.value.profileId === profileId) total += cursor.value.sizeBytes;
    cursor = await cursor.continue();
  }
  return total;
}
