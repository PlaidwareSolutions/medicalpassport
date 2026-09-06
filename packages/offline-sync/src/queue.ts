import { openOfflineDb } from "./db.js";
import { isSyncMutationKind, syncMutationKey, type OfflineMutation } from "./contract.js";

/**
 * Queues a mutation captured while offline (or while a request failed).
 * Refuses an (entity, operation) pair outside `SYNC_MUTATIONS` — the server
 * would only ever answer it with an `invalid` conflict, leaving it stuck in
 * the queue, so it's better to fail loudly at the call site (docs/15:
 * "never silently dropped" cuts both ways).
 */
export async function enqueueMutation(mutation: OfflineMutation): Promise<void> {
  if (!isSyncMutationKind(mutation)) {
    throw new Error(`Mutation ${syncMutationKey(mutation)} is not in the sync contract and cannot be queued`);
  }
  const db = await openOfflineDb();
  await db.put("mutations", mutation);
}

/** Mutations in capture order — replay must preserve per-entity ordering (docs/15). */
export async function listPendingMutations(): Promise<OfflineMutation[]> {
  const db = await openOfflineDb();
  return db.getAllFromIndex("mutations", "by-capturedAt");
}

export async function removeMutation(clientMutationId: string): Promise<void> {
  const db = await openOfflineDb();
  await db.delete("mutations", clientMutationId);
}

export async function pendingMutationCount(): Promise<number> {
  const db = await openOfflineDb();
  return db.count("mutations");
}
