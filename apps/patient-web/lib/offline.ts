"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkStorageStatus,
  clearDocumentIntent,
  getLastSynced,
  getSyncCursor,
  listConflicts,
  listPendingMutations,
  pendingMutationCount,
  recordConflict,
  removeMutation,
  setLastSynced,
  setSyncCursor,
  trimToEssentials,
  type DocumentIntentProgress,
  type DocumentUploadIntentPayload,
  type OfflineMutation,
  type SyncChangeSignal,
  type SyncResponse,
  type SyncStatus,
} from "@medpass/offline-sync";
import { api, getActiveProfileId } from "./api";

/**
 * Fired with a `DocumentIntentProgress` detail each time a queued document
 * capture moves (create done, a page complete, failed) — the pending screen
 * shows "sending page 2 of 3" from it (docs_v2/05 §14).
 */
export const SYNC_PROGRESS_EVENT = "medpass:sync-progress";
/** Fired whenever the pending queue changed shape — something queued, applied, or parked as a conflict. */
export const PENDING_CHANGED_EVENT = "medpass:pending-changed";

function dispatch(name: string, detail?: unknown): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Entities whose `invalid` outcome is final rather than retryable: the
 * server ran the same checks it runs online (an implausible reading; a
 * document whose pages never verified) and retrying the identical payload
 * can only get the identical answer. They are parked for review, where a
 * medicine `invalid` today stays queued.
 */
const PARK_ON_INVALID = new Set<string>(["observation", "document_upload_intent"]);

/** Fixed +05:30 offset — matches the scheduling engine's Asia/Kolkata simplification (docs/16). */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Fired once per incremental change signal a sync round-trip reports
 * (docs/15 `changes[]`) — an invalidation, not a patch: listening hooks
 * (`useMedications`, `useTimeline`) just re-fetch their own data fresh when
 * their scope/profile/date matches, the same live-fetch path they already
 * use on mount (docs/12 H-12: never patch stale data in place).
 */
export const REMOTE_CHANGE_EVENT = "medpass:remote-change";

/**
 * Applies one `/sync` response: removes applied mutations, parks
 * unmergeable conflicts for the patient to review instead of retrying them
 * forever (docs/15 "needs your review" — never silently dropped), dispatches
 * remote-change signals, and advances the incremental-sync cursor. Returns
 * whether anything in this response should keep the sync status "failed"
 * (a still-unretryable conflict) — `row_version`/`field_conflict`/`deleted`
 * are already resolved outcomes, not failures, once parked for review.
 */
async function applySyncResponse(res: SyncResponse, batch: OfflineMutation[], profileId: string | undefined): Promise<boolean> {
  let unretryable = false;
  const localChanges = new Map<string, SyncChangeSignal>();
  for (const id of res.applied) {
    const mutation = batch.find((m) => m.clientMutationId === id);
    await removeMutation(id);
    if (mutation?.entity === "document_upload_intent") await clearDocumentIntent(id);
    // This device's own replay landed: the diary / documents list refresh
    // now, without waiting for the next cursor poll to say so.
    if (mutation?.entity === "observation") localChanges.set(`${mutation.profileId}:observations`, { profileId: mutation.profileId, scope: "observations" });
    if (mutation?.entity === "document_upload_intent") localChanges.set(`${mutation.profileId}:documents`, { profileId: mutation.profileId, scope: "documents" });
  }

  for (const conflict of res.conflicts) {
    const mutation = batch.find((m) => m.clientMutationId === conflict.clientMutationId);
    const parkable =
      conflict.kind === "row_version" ||
      conflict.kind === "field_conflict" ||
      conflict.kind === "deleted" ||
      (conflict.kind === "invalid" && mutation !== undefined && PARK_ON_INVALID.has(mutation.entity));
    if (parkable && mutation) {
      await recordConflict({
        clientMutationId: conflict.clientMutationId,
        profileId: mutation.profileId,
        entity: mutation.entity,
        kind: conflict.kind,
        unmergedFields: conflict.unmergedFields,
        serverState: conflict.serverState,
        detectedAt: new Date().toISOString(),
      });
      await removeMutation(conflict.clientMutationId);
      if (mutation.entity === "document_upload_intent") await clearDocumentIntent(conflict.clientMutationId);
    } else {
      unretryable = true; // permission_revoked / invalid — no safe automatic resolution, stays queued
    }
  }

  for (const change of res.changes) localChanges.set(`${change.profileId}:${change.scope}:${(change.dates ?? []).join(",")}`, change);
  for (const change of localChanges.values()) dispatch(REMOTE_CHANGE_EVENT, change);

  if (profileId) await setSyncCursor(profileId, res.nextCursor);
  return unretryable;
}

/**
 * Runs the upload sequence for every queued document capture in the batch
 * (docs_v2/05 §14) BEFORE the batch is posted, so each intent reaches
 * `/sync` carrying the document it produced. A network failure stops the
 * flush in capture order, like any other; a server refusal (quota, a
 * quarantined page) is parked for review — the bytes are dropped with it,
 * because retrying the identical upload cannot change the answer.
 * Returns the envelopes ready to post, or `undefined` to stop the flush.
 */
async function prepareBatch(batch: OfflineMutation[]): Promise<{ envelopes: ReturnType<typeof toEnvelopes>; sent: OfflineMutation[] } | undefined> {
  const { replayDocumentUploadIntent, DocumentReplayError } = await import("./document-intents");
  const sent: OfflineMutation[] = [];
  const envelopes: ReturnType<typeof toEnvelopes> = [];
  for (const mutation of batch) {
    if (mutation.entity !== "document_upload_intent") {
      sent.push(mutation);
      envelopes.push(...toEnvelopes([mutation]));
      continue;
    }
    try {
      const { documentId } = await replayDocumentUploadIntent(mutation as OfflineMutation<DocumentUploadIntentPayload>, (progress) =>
        dispatch(SYNC_PROGRESS_EVENT, progress),
      );
      sent.push(mutation);
      envelopes.push(...toEnvelopes([{ ...mutation, payload: { ...(mutation.payload as DocumentUploadIntentPayload), documentId } }]));
    } catch (err) {
      if (err instanceof DocumentReplayError && err.reason === "rejected") {
        await recordConflict({
          clientMutationId: mutation.clientMutationId,
          profileId: mutation.profileId,
          entity: mutation.entity,
          kind: "upload_failed",
          detectedAt: new Date().toISOString(),
        });
        await removeMutation(mutation.clientMutationId);
        await clearDocumentIntent(mutation.clientMutationId);
        dispatch(PENDING_CHANGED_EVENT);
        continue;
      }
      return undefined; // a genuine network failure — stop here, keep order
    }
  }
  return { envelopes, sent };
}

/** Progress of a queued document capture as a plain read, for a screen mounting mid-flush. */
export type { DocumentIntentProgress };

/** Batch cap per docs/15 — chunked client-side so a large queue still flushes. */
const SYNC_BATCH_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toEnvelopes(mutations: OfflineMutation[]) {
  return mutations.map(({ clientMutationId, entity, operation, payload, profileId, capturedAt, baseRowVersion }) => ({
    clientMutationId,
    entity,
    operation,
    payload,
    profileId,
    capturedAt,
    baseRowVersion,
  }));
}

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt: string | undefined;
  /** True only for the flush cycle that actually trimmed the cache (docs/15 low-storage mode) — not sticky across renders. */
  storageTrimmed: boolean;
  /** Mutations parked as "needs your review" (docs/15) — see /sync/conflicts. */
  conflictCount: number;
  /** Manual retry — surfaced in the UI when a flush attempt has failed. */
  flush: () => Promise<void>;
}

const MUTATION_QUEUED_EVENT = "medpass:mutation-queued";

/**
 * Called right after a mutation is enqueued (e.g. an offline dose
 * recording) so the sync engine's pending count updates immediately rather
 * than waiting for the next online/visibility event — those two hook
 * instances have no other connection to each other.
 */
export function notifyMutationQueued(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MUTATION_QUEUED_EVENT));
  dispatch(PENDING_CHANGED_EVENT);
}

/**
 * Flushes the offline mutation queue whenever the app opens, the browser
 * comes back online, or the tab regains visibility (docs/32: Background
 * Sync isn't available everywhere, so "retry on reopen" is the mandated
 * fallback, not an afterthought). Mutations replay in capture order and
 * stop at the first failure so ordering is never violated (docs/15).
 *
 * Also polls for incremental server→client changes (docs/15 `changes[]`)
 * even with nothing locally queued — a caregiver's edit made while this
 * device was offline needs its own signal, not just "my mutations applied."
 */
/**
 * `activeProfileId` is accepted (rather than read internally via
 * `getActiveProfileId()` alone) so a caregiver switching profiles refreshes
 * `conflictCount`/`lastSyncedAt` for the newly active profile immediately —
 * neither is otherwise re-derived until an unrelated online/offline/
 * visibility/mutation-queued event happens to fire (docs/10 H-13: a stale
 * conflict count or last-synced time from the previous profile is exactly
 * the kind of cross-profile leak that hazard exists to prevent). The rest of
 * the engine (in-flight flush state, `pendingCount`) deliberately does NOT
 * remount on profile switch — see AppShell's `key`-based remount boundary,
 * which wraps `{children}` only, not this hook.
 */
export function useSyncEngine(activeProfileId?: string): SyncState {
  const [status, setStatus] = useState<SyncStatus>("online");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>();
  const [storageTrimmed, setStorageTrimmed] = useState(false);
  const [conflictCount, setConflictCount] = useState(0);
  const flushingRef = useRef(false);

  const refreshCounts = useCallback(async () => {
    setPendingCount(await pendingMutationCount());
    const profileId = getActiveProfileId();
    setConflictCount((await listConflicts(profileId)).length);
  }, []);

  const flushLocked = useCallback(async () => {
    if (flushingRef.current) return;
    const profileId = getActiveProfileId();
    const mutations = await listPendingMutations();
    if (mutations.length === 0 && !profileId) {
      setStatus("online"); // nothing queued and no profile to poll changes for
      return;
    }

    flushingRef.current = true;
    setStatus("syncing");
    setStorageTrimmed(false);
    try {
      let failed = false;
      // An empty queue still makes one round-trip — purely to pull
      // incremental changes; a real queue chunks as before (docs/15 batch cap).
      const batches = mutations.length > 0 ? chunk(mutations, SYNC_BATCH_SIZE) : [[]];
      for (const batch of batches) {
        try {
          // Queued document captures upload their pages first (docs_v2/05
          // §14) so their envelopes carry the document they produced.
          const prepared = await prepareBatch(batch);
          if (!prepared) {
            failed = true;
            break;
          }
          const cursor = profileId ? await getSyncCursor(profileId) : undefined;
          // Every mutation replays through the one generic sync endpoint
          // (docs/15), dispatched server-side by entity+operation. Its
          // idempotency ledger on clientMutationId makes this exactly-once
          // even if a previous flush attempt partially succeeded.
          const res = await api.post<SyncResponse>("/sync", { mutations: prepared.envelopes, cursor, profileId });
          const unretryable = await applySyncResponse(res, prepared.sent, profileId);
          dispatch(PENDING_CHANGED_EVENT);
          if (unretryable) failed = true;
        } catch {
          failed = true;
          break; // preserve capture order — don't attempt later batches after a genuine failure
        }
      }

      await refreshCounts();
      if (profileId && !failed) {
        const now = new Date().toISOString();
        await setLastSynced(profileId, now);
        setLastSyncedAt(now);

        const storage = await checkStorageStatus();
        if (storage.low) {
          await trimToEssentials(profileId, istToday());
          setStorageTrimmed(true);
        }
      }
      const remaining = await pendingMutationCount();
      setStatus(failed ? "sync_failed" : remaining > 0 ? "changes_pending" : "online");
    } catch {
      setStatus("sync_failed");
    } finally {
      flushingRef.current = false;
    }
  }, [refreshCounts]);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    // Two open tabs share one IndexedDB queue and both hear the same
    // `online` event; without a lock they would replay the same document
    // capture side by side. The Web Locks API serialises them where it
    // exists (every browser docs/32 targets); elsewhere the server's
    // idempotency keys still keep the outcome exactly-once.
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks) await locks.request("medpass:sync-flush", () => flushLocked());
    else await flushLocked();
  }, [flushLocked]);

  // Re-derives profile-scoped counts on every profile switch, without
  // remounting the rest of the engine (see the function doc comment above).
  useEffect(() => {
    void refreshCounts();
    if (activeProfileId) void getLastSynced(activeProfileId).then(setLastSyncedAt);
  }, [activeProfileId, refreshCounts]);

  useEffect(() => {
    const goOnline = () => void flush();
    const goOffline = () => setStatus("offline");
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    const onMutationQueued = () => void refreshCounts();

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(MUTATION_QUEUED_EVENT, onMutationQueued);
    void flush();

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(MUTATION_QUEUED_EVENT, onMutationQueued);
    };
  }, [flush, refreshCounts]);

  return { status, pendingCount, lastSyncedAt, storageTrimmed, conflictCount, flush };
}
