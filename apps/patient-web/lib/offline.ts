"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkStorageStatus,
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
  type OfflineMutation,
  type SyncResponse,
  type SyncStatus,
} from "@medpass/offline-sync";
import { api, getActiveProfileId } from "./api";

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
  for (const id of res.applied) await removeMutation(id);

  for (const conflict of res.conflicts) {
    if (conflict.kind === "row_version" || conflict.kind === "field_conflict" || conflict.kind === "deleted") {
      const mutation = batch.find((m) => m.clientMutationId === conflict.clientMutationId);
      if (mutation) {
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
      }
    } else {
      unretryable = true; // permission_revoked / invalid — no safe automatic resolution, stays queued
    }
  }

  for (const change of res.changes) {
    window.dispatchEvent(new CustomEvent(REMOTE_CHANGE_EVENT, { detail: change }));
  }

  if (profileId) await setSyncCursor(profileId, res.nextCursor);
  return unretryable;
}

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
export function useSyncEngine(): SyncState {
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

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
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
          const cursor = profileId ? await getSyncCursor(profileId) : undefined;
          // Every mutation replays through the one generic sync endpoint
          // (docs/15), dispatched server-side by entity+operation. Its
          // idempotency ledger on clientMutationId makes this exactly-once
          // even if a previous flush attempt partially succeeded.
          const res = await api.post<SyncResponse>("/sync", { mutations: toEnvelopes(batch), cursor, profileId });
          const unretryable = await applySyncResponse(res, batch, profileId);
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

  useEffect(() => {
    void refreshCounts();
    const profileId = getActiveProfileId();
    if (profileId) void getLastSynced(profileId).then(setLastSyncedAt);

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
