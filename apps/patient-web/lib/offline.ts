"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLastSynced,
  listPendingMutations,
  pendingMutationCount,
  removeMutation,
  setLastSynced,
  type SyncStatus,
} from "@medpass/offline-sync";
import { api, getActiveProfileId } from "./api";

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt: string | undefined;
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
 */
export function useSyncEngine(): SyncState {
  const [status, setStatus] = useState<SyncStatus>("online");
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>();
  const flushingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    setPendingCount(await pendingMutationCount());
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setStatus("offline");
      return;
    }
    flushingRef.current = true;
    setStatus("syncing");
    try {
      const mutations = await listPendingMutations();
      let failed = false;
      for (const mutation of mutations) {
        try {
          // The payload already carries clientMutationId (docs/15) — the
          // API's idempotency check on that key makes this exactly-once
          // even if a previous flush attempt partially succeeded.
          await api.post(mutation.endpoint, mutation.payload, { profileId: mutation.profileId });
          await removeMutation(mutation.clientMutationId);
        } catch {
          failed = true;
          break; // preserve capture order — don't skip ahead on failure
        }
      }
      await refreshPendingCount();
      const profileId = getActiveProfileId();
      if (profileId && !failed) {
        const now = new Date().toISOString();
        await setLastSynced(profileId, now);
        setLastSyncedAt(now);
      }
      const remaining = await pendingMutationCount();
      setStatus(failed ? "sync_failed" : remaining > 0 ? "changes_pending" : "online");
    } catch {
      setStatus("sync_failed");
    } finally {
      flushingRef.current = false;
    }
  }, [refreshPendingCount]);

  useEffect(() => {
    void refreshPendingCount();
    const profileId = getActiveProfileId();
    if (profileId) void getLastSynced(profileId).then(setLastSyncedAt);

    const goOnline = () => void flush();
    const goOffline = () => setStatus("offline");
    const onVisible = () => {
      if (document.visibilityState === "visible") void flush();
    };
    const onMutationQueued = () => void refreshPendingCount();

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
  }, [flush, refreshPendingCount]);

  return { status, pendingCount, lastSyncedAt, flush };
}
