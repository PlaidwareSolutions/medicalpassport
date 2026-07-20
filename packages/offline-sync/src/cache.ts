import { openOfflineDb, type StoredConflict } from "./db.js";

/**
 * Caches a medications list for offline viewing (docs/15). `variant`
 * distinguishes queries like "current" (Home) from "all" (Medicines
 * history tab) — each is cached and served independently.
 */
export async function cacheMedications<T>(profileId: string, variant: string, items: T): Promise<void> {
  const db = await openOfflineDb();
  const key = `${profileId}:${variant}`;
  await db.put("medications", { key, profileId, items, cachedAt: new Date().toISOString() });
}

export async function getCachedMedications<T>(
  profileId: string,
  variant: string,
): Promise<{ items: T; cachedAt: string } | undefined> {
  const db = await openOfflineDb();
  const record = await db.get("medications", `${profileId}:${variant}`);
  if (!record) return undefined;
  return { items: record.items as T, cachedAt: record.cachedAt };
}

/** Caches one day's timeline for offline viewing (docs/15). */
export async function cacheTimeline<T>(profileId: string, date: string, items: T): Promise<void> {
  const db = await openOfflineDb();
  const key = `${profileId}:${date}`;
  await db.put("timeline", { key, profileId, date, items, cachedAt: new Date().toISOString() });
}

export async function getCachedTimeline<T>(
  profileId: string,
  date: string,
): Promise<{ items: T; cachedAt: string } | undefined> {
  const db = await openOfflineDb();
  const record = await db.get("timeline", `${profileId}:${date}`);
  if (!record) return undefined;
  return { items: record.items as T, cachedAt: record.cachedAt };
}

/** Incremental-sync cursor (docs/15 `changes[]`/cursor) — one per profile, since changes are computed per profile. */
export async function setSyncCursor(profileId: string, cursor: string): Promise<void> {
  const db = await openOfflineDb();
  await db.put("meta", { key: `cursor:${profileId}`, value: cursor });
}

export async function getSyncCursor(profileId: string): Promise<string | undefined> {
  const db = await openOfflineDb();
  const record = await db.get("meta", `cursor:${profileId}`);
  return record?.value;
}

/**
 * A mutation the server couldn't (fully) apply on conflict — parked for the
 * patient to review rather than retried forever or silently dropped
 * (docs/15 "needs your review"). Replaces any existing entry for the same
 * mutation (there's only ever one live conflict per clientMutationId).
 */
export async function recordConflict(conflict: StoredConflict): Promise<void> {
  const db = await openOfflineDb();
  await db.put("conflicts", conflict);
}

export async function listConflicts(profileId?: string): Promise<StoredConflict[]> {
  const db = await openOfflineDb();
  const all = await db.getAll("conflicts");
  return profileId ? all.filter((c) => c.profileId === profileId) : all;
}

/** The patient has reviewed this conflict (kept the server's version, or already reapplied their change manually). */
export async function dismissConflict(clientMutationId: string): Promise<void> {
  const db = await openOfflineDb();
  await db.delete("conflicts", clientMutationId);
}

export async function setLastSynced(profileId: string, whenIso: string): Promise<void> {
  const db = await openOfflineDb();
  await db.put("meta", { key: `lastSynced:${profileId}`, value: whenIso });
}

export async function getLastSynced(profileId: string): Promise<string | undefined> {
  const db = await openOfflineDb();
  const record = await db.get("meta", `lastSynced:${profileId}`);
  return record?.value;
}

/**
 * Purges all cached data for a profile — called on logout and on session
 * revocation (docs/15: "Removal of local data after logout where
 * practical"). Mutations are intentionally NOT cleared by profile filter
 * alone here; callers should clear the whole queue on logout since a
 * revoked session can never replay its mutations anyway.
 */
export async function clearProfileData(profileId: string): Promise<void> {
  const db = await openOfflineDb();
  for (const storeName of ["medications", "timeline"] as const) {
    const tx = db.transaction(storeName, "readwrite");
    let cursor = await tx.store.openCursor();
    while (cursor) {
      if (cursor.value.profileId === profileId) await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
  const conflictsTx = db.transaction("conflicts", "readwrite");
  let conflictCursor = await conflictsTx.store.openCursor();
  while (conflictCursor) {
    if (conflictCursor.value.profileId === profileId) await conflictCursor.delete();
    conflictCursor = await conflictCursor.continue();
  }
  await conflictsTx.done;
  await db.delete("meta", `lastSynced:${profileId}`);
  await db.delete("meta", `cursor:${profileId}`);
}

export interface StorageStatus {
  usageRatio: number;
  low: boolean;
}

/** Below this fraction of the browser's storage quota, low-storage mode kicks in (docs/15). */
const LOW_STORAGE_THRESHOLD = 0.8;

/** `navigator.storage.estimate()` isn't available everywhere (docs/32 fallback matrix) — absent means "assume fine," never a false alarm. */
export async function checkStorageStatus(): Promise<StorageStatus> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return { usageRatio: 0, low: false };
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const usageRatio = quota > 0 ? usage / quota : 0;
  return { usageRatio, low: usageRatio >= LOW_STORAGE_THRESHOLD };
}

/**
 * Low-storage mode (docs/15): trims cached data to just today's schedule
 * plus the "current medicines" list — the minimum the offline goal (spec
 * §19: view confirmed medications and today's schedule offline) actually
 * needs — dropping every other cached timeline date and the "all
 * medicines" history variant. Never touches the mutation queue: unsynced
 * changes are never discarded to free space.
 */
export async function trimToEssentials(profileId: string, todayDate: string): Promise<void> {
  const db = await openOfflineDb();

  const timelineTx = db.transaction("timeline", "readwrite");
  let timelineCursor = await timelineTx.store.openCursor();
  while (timelineCursor) {
    if (timelineCursor.value.profileId === profileId && timelineCursor.value.date !== todayDate) await timelineCursor.delete();
    timelineCursor = await timelineCursor.continue();
  }
  await timelineTx.done;

  const medicationsTx = db.transaction("medications", "readwrite");
  let medicationsCursor = await medicationsTx.store.openCursor();
  const keepKey = `${profileId}:current`;
  while (medicationsCursor) {
    if (medicationsCursor.value.profileId === profileId && medicationsCursor.value.key !== keepKey) await medicationsCursor.delete();
    medicationsCursor = await medicationsCursor.continue();
  }
  await medicationsTx.done;
}

/** Wipes everything — used on full logout (docs/15). */
export async function clearAllOfflineData(): Promise<void> {
  const db = await openOfflineDb();
  await Promise.all([
    db.clear("medications"),
    db.clear("timeline"),
    db.clear("mutations"),
    db.clear("meta"),
    db.clear("conflicts"),
  ]);
}
