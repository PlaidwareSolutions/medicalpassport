import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { OfflineMutation } from "./contract.js";

interface CacheRecord<T> {
  key: string;
  profileId: string;
  items: T;
  cachedAt: string;
}

interface OfflineSchema extends DBSchema {
  medications: {
    key: string; // profileId
    value: CacheRecord<unknown>;
  };
  timeline: {
    key: string; // `${profileId}:${date}`
    value: CacheRecord<unknown> & { date: string };
  };
  mutations: {
    key: string; // clientMutationId
    value: OfflineMutation;
    indexes: { "by-capturedAt": string };
  };
  meta: {
    key: string;
    value: { key: string; value: string };
  };
}

const DB_NAME = "medpass-offline";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<OfflineSchema>> | undefined;

/**
 * Opens the offline cache database. Only ever called from a browser context
 * (or a test with an IndexedDB polyfill) — this package is never imported
 * into anything running clinical logic (docs/02 non-negotiable rule 6); it
 * only ever caches what the server already decided.
 */
export function openOfflineDb(): Promise<IDBPDatabase<OfflineSchema>> {
  dbPromise ??= openDB<OfflineSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("medications")) db.createObjectStore("medications", { keyPath: "key" });
      if (!db.objectStoreNames.contains("timeline")) db.createObjectStore("timeline", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("mutations")) {
        const store = db.createObjectStore("mutations", { keyPath: "clientMutationId" });
        store.createIndex("by-capturedAt", "capturedAt");
      }
    },
  });
  return dbPromise;
}

/** Test-only: forces the next openOfflineDb() call to open a fresh connection. */
export function _resetDbHandleForTests(): void {
  dbPromise = undefined;
}

export type { OfflineSchema, CacheRecord };
