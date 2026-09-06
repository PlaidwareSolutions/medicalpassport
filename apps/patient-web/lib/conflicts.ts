"use client";
import { useCallback, useEffect, useState } from "react";
import {
  clearDocumentIntent,
  dismissConflict,
  listConflicts,
  listDocumentIntentProgress,
  listPendingMutations,
  type DocumentIntentProgress,
  type OfflineMutation,
  type StoredConflict,
} from "@medpass/offline-sync";
import { getActiveProfileId } from "./api";
import { PENDING_CHANGED_EVENT, SYNC_PROGRESS_EVENT } from "./offline";

/** Mutations a sync round-trip couldn't (fully) apply — docs/15 "needs your review". */
export function useConflicts() {
  const [items, setItems] = useState<StoredConflict[] | undefined>();

  const load = useCallback(async () => {
    setItems(await listConflicts(getActiveProfileId()));
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(PENDING_CHANGED_EVENT, load);
    return () => window.removeEventListener(PENDING_CHANGED_EVENT, load);
  }, [load]);

  return { items, reload: load };
}

/**
 * The patient has reviewed this conflict — accepts the server's version
 * as-is. A parked document capture also releases the page bytes it was
 * still holding on the phone.
 */
export async function resolveConflict(clientMutationId: string): Promise<void> {
  await dismissConflict(clientMutationId);
  await clearDocumentIntent(clientMutationId);
}

export interface PendingItem {
  mutation: OfflineMutation;
  /** Only for a queued document capture: where its upload sequence has got to. */
  progress?: DocumentIntentProgress;
}

/**
 * What is still waiting to send for the active profile, in capture order
 * (docs_v2/05 §14 "pending" view), with live progress for document
 * captures. Re-reads on every queue change and every replay step.
 */
export function usePendingSync() {
  const [items, setItems] = useState<PendingItem[] | undefined>();

  const load = useCallback(async () => {
    const profileId = getActiveProfileId();
    const [mutations, progress] = await Promise.all([listPendingMutations(), listDocumentIntentProgress(profileId)]);
    const byId = new Map(progress.map((p) => [p.clientMutationId, p]));
    setItems(mutations.filter((m) => !profileId || m.profileId === profileId).map((mutation) => ({ mutation, progress: byId.get(mutation.clientMutationId) })));
  }, []);

  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(PENDING_CHANGED_EVENT, onChange);
    window.addEventListener(SYNC_PROGRESS_EVENT, onChange);
    return () => {
      window.removeEventListener(PENDING_CHANGED_EVENT, onChange);
      window.removeEventListener(SYNC_PROGRESS_EVENT, onChange);
    };
  }, [load]);

  return { items, reload: load };
}
