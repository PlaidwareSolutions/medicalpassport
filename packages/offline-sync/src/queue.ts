import { openOfflineDb } from "./db.js";
import type { OfflineMutation } from "./contract.js";

/** Queues a mutation captured while offline (or while a request failed). */
export async function enqueueMutation(mutation: OfflineMutation): Promise<void> {
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
