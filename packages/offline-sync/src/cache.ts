import { openOfflineDb } from "./db.js";

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
  await db.delete("meta", `lastSynced:${profileId}`);
}

/** Wipes everything — used on full logout (docs/15). */
export async function clearAllOfflineData(): Promise<void> {
  const db = await openOfflineDb();
  await Promise.all([
    db.clear("medications"),
    db.clear("timeline"),
    db.clear("mutations"),
    db.clear("meta"),
  ]);
}
