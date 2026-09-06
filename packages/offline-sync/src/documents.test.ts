import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearAllOfflineData, clearProfileData, listConflicts, recordConflict, trimToEssentials } from "./cache.js";
import { isSyncMutationKind, type DocumentUploadIntentPayload, type OfflineMutation } from "./contract.js";
import { _resetDbHandleForTests } from "./db.js";
import {
  clearDocumentIntent,
  dropDocumentPage,
  enqueueDocumentUploadIntent,
  getDocumentIntentProgress,
  listDocumentIntentProgress,
  listDocumentPages,
  pendingDocumentBytes,
  setDocumentIntentProgress,
} from "./documents.js";
import { enqueueMutation, listPendingMutations, pendingMutationCount, removeMutation } from "./queue.js";

const PROFILE_A = "profile-a";
const PROFILE_B = "profile-b";

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function intent(overrides: Partial<OfflineMutation<DocumentUploadIntentPayload>> = {}): OfflineMutation<DocumentUploadIntentPayload> {
  return {
    clientMutationId: crypto.randomUUID(),
    entity: "document_upload_intent",
    operation: "create",
    profileId: PROFILE_A,
    capturedAt: new Date().toISOString(),
    payload: {
      kind: "prescription",
      sourceChannel: "camera",
      pages: [
        { pageNumber: 1, contentType: "image/jpeg", sizeBytes: 5 },
        { pageNumber: 2, contentType: "image/jpeg", sizeBytes: 5 },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  _resetDbHandleForTests();
});

afterEach(async () => {
  await clearAllOfflineData();
  _resetDbHandleForTests();
});

describe("docs_v2/05 §14 entities in the contract", () => {
  it("declares observation/create and document_upload_intent/create, and only their creates", () => {
    expect(isSyncMutationKind({ entity: "observation", operation: "create" })).toBe(true);
    expect(isSyncMutationKind({ entity: "document_upload_intent", operation: "create" })).toBe(true);
    expect(isSyncMutationKind({ entity: "observation", operation: "update" })).toBe(false);
    expect(isSyncMutationKind({ entity: "document_upload_intent", operation: "update" })).toBe(false);
  });

  it("queues an observation captured offline in capture order alongside a dose", async () => {
    const dose: OfflineMutation = { clientMutationId: crypto.randomUUID(), entity: "dose_event", operation: "create", payload: { action: "taken" }, capturedAt: "2026-09-06T08:00:00.000Z", profileId: PROFILE_A };
    const reading: OfflineMutation = {
      clientMutationId: crypto.randomUUID(),
      entity: "observation",
      operation: "create",
      payload: { concept: "blood_pressure", valueNumeric: 128, valueNumeric2: 82, measuredAt: "2026-09-06T08:05:00.000Z" },
      capturedAt: "2026-09-06T08:05:00.000Z",
      profileId: PROFILE_A,
    };
    await enqueueMutation(reading);
    await enqueueMutation(dose);
    expect((await listPendingMutations()).map((m) => m.entity)).toEqual(["dose_event", "observation"]);
  });
});

describe("document upload intents", () => {
  it("stores the page bytes and a queued progress record, then the mutation", async () => {
    const m = intent();
    await enqueueDocumentUploadIntent(m, [
      { pageNumber: 1, contentType: "image/jpeg", name: "p1.jpg", bytes: bytesOf("page1") },
      { pageNumber: 2, contentType: "image/jpeg", name: "p2.jpg", bytes: bytesOf("page2") },
    ]);

    expect(await pendingMutationCount()).toBe(1);
    const pages = await listDocumentPages(m.clientMutationId);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(pages.map((p) => p.sizeBytes)).toEqual([5, 5]);
    expect(new TextDecoder().decode(pages[1]!.bytes)).toBe("page2");
    expect(pages[0]!.profileId).toBe(PROFILE_A);
    expect(await pendingDocumentBytes()).toBe(10);
    expect(await getDocumentIntentProgress(m.clientMutationId)).toMatchObject({ documentId: undefined, completedPages: [], status: "queued" });
  });

  it("refuses bytes that do not match the declared pages, leaving nothing behind", async () => {
    const m = intent();
    await expect(enqueueDocumentUploadIntent(m, [{ pageNumber: 1, contentType: "image/jpeg", name: "p1.jpg", bytes: bytesOf("only") }])).rejects.toThrow(/exactly the pages/);
    expect(await pendingMutationCount()).toBe(0);
    expect(await listDocumentPages(m.clientMutationId)).toEqual([]);
  });

  it("carries an online attempt's progress so a resume continues on the same document", async () => {
    const m = intent();
    await enqueueDocumentUploadIntent(
      m,
      [
        { pageNumber: 1, contentType: "image/jpeg", name: "p1.jpg", bytes: bytesOf("page1") },
        { pageNumber: 2, contentType: "image/jpeg", name: "p2.jpg", bytes: bytesOf("page2") },
      ],
      { documentId: "doc-1", completedPages: [1] },
    );
    expect(await getDocumentIntentProgress(m.clientMutationId)).toMatchObject({ documentId: "doc-1", completedPages: [1], status: "queued" });
  });

  it("drops a page's bytes once it is complete and records the step", async () => {
    const m = intent();
    await enqueueDocumentUploadIntent(m, [
      { pageNumber: 1, contentType: "image/jpeg", name: "p1.jpg", bytes: bytesOf("page1") },
      { pageNumber: 2, contentType: "image/jpeg", name: "p2.jpg", bytes: bytesOf("page2") },
    ]);
    const progress = (await getDocumentIntentProgress(m.clientMutationId))!;
    await setDocumentIntentProgress({ ...progress, status: "uploading", documentId: "doc-1" });
    await dropDocumentPage(m.clientMutationId, 1);
    await setDocumentIntentProgress({ ...progress, status: "uploading", documentId: "doc-1", completedPages: [1] });

    expect((await listDocumentPages(m.clientMutationId)).map((p) => p.pageNumber)).toEqual([2]);
    expect(await pendingDocumentBytes(PROFILE_A)).toBe(5);
    const after = (await getDocumentIntentProgress(m.clientMutationId))!;
    expect(after).toMatchObject({ documentId: "doc-1", completedPages: [1], status: "uploading" });
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(progress.updatedAt).getTime() - 1);
  });

  it("lists progress per profile, and clearing an intent removes its bytes and progress but not other intents", async () => {
    const a = intent();
    const b = intent({ profileId: PROFILE_B });
    await enqueueDocumentUploadIntent(a, [
      { pageNumber: 1, contentType: "image/jpeg", name: "a1.jpg", bytes: bytesOf("a1") },
      { pageNumber: 2, contentType: "image/jpeg", name: "a2.jpg", bytes: bytesOf("a2") },
    ]);
    await enqueueDocumentUploadIntent(b, [
      { pageNumber: 1, contentType: "image/jpeg", name: "b1.jpg", bytes: bytesOf("b1") },
      { pageNumber: 2, contentType: "image/jpeg", name: "b2.jpg", bytes: bytesOf("b2") },
    ]);
    expect((await listDocumentIntentProgress(PROFILE_A)).map((p) => p.clientMutationId)).toEqual([a.clientMutationId]);
    expect(await listDocumentIntentProgress()).toHaveLength(2);

    await clearDocumentIntent(a.clientMutationId);
    await removeMutation(a.clientMutationId);
    expect(await listDocumentPages(a.clientMutationId)).toEqual([]);
    expect(await getDocumentIntentProgress(a.clientMutationId)).toBeUndefined();
    expect(await listDocumentPages(b.clientMutationId)).toHaveLength(2);
    expect(await pendingMutationCount()).toBe(1);
  });

  it("a parked upload conflict lives in the same review store as a medicine conflict", async () => {
    const m = intent();
    await recordConflict({ clientMutationId: m.clientMutationId, profileId: PROFILE_A, entity: m.entity, kind: "upload_failed", detectedAt: new Date().toISOString() });
    await recordConflict({ clientMutationId: "obs-1", profileId: PROFILE_A, entity: "observation", kind: "deleted", serverState: { concept: "blood_pressure" }, detectedAt: new Date().toISOString() });
    expect((await listConflicts(PROFILE_A)).map((c) => `${c.entity}:${c.kind}`).sort()).toEqual(["document_upload_intent:upload_failed", "observation:deleted"]);
  });

  it("is never trimmed by low-storage mode and survives a per-profile cache purge; only a full logout wipes it", async () => {
    const m = intent();
    await enqueueDocumentUploadIntent(m, [
      { pageNumber: 1, contentType: "image/jpeg", name: "p1.jpg", bytes: bytesOf("page1") },
      { pageNumber: 2, contentType: "image/jpeg", name: "p2.jpg", bytes: bytesOf("page2") },
    ]);
    await trimToEssentials(PROFILE_A, "2026-09-06");
    await clearProfileData(PROFILE_A);
    expect(await listDocumentPages(m.clientMutationId)).toHaveLength(2);
    expect(await getDocumentIntentProgress(m.clientMutationId)).toBeDefined();
    expect(await pendingMutationCount()).toBe(1);

    await clearAllOfflineData();
    expect(await listDocumentPages(m.clientMutationId)).toEqual([]);
    expect(await getDocumentIntentProgress(m.clientMutationId)).toBeUndefined();
    expect(await pendingDocumentBytes()).toBe(0);
  });
});
