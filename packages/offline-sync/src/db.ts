import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DocumentIntentProgress, OfflineMutation } from "./contract.js";

interface CacheRecord<T> {
  key: string;
  profileId: string;
  items: T;
  cachedAt: string;
}

export interface StoredConflict {
  clientMutationId: string;
  profileId: string;
  entity: string;
  kind: string;
  unmergedFields?: string[];
  serverState?: unknown;
  detectedAt: string;
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
  /** Mutations a sync round-trip couldn't (fully) apply — docs/15 "needs your review", never silently dropped. */
  conflicts: {
    key: string; // clientMutationId
    value: StoredConflict;
  };
  /**
   * Page bytes of a document captured offline (docs_v2/05 §14) — PHI, so
   * IndexedDB and never a service-worker cache (docs/15). Keyed per page so
   * one page can be dropped once it has been uploaded and completed.
   */
  documentPages: {
    key: string; // `${clientMutationId}:${pageNumber}`
    value: StoredDocumentPage;
    indexes: { "by-mutation": string };
  };
  /** Replay progress per queued document intent — see `DocumentIntentProgress`. */
  documentIntents: {
    key: string; // clientMutationId
    value: DocumentIntentProgress;
  };
}

export interface StoredDocumentPage {
  key: string;
  clientMutationId: string;
  profileId: string;
  pageNumber: number;
  contentType: string;
  sizeBytes: number;
  /** The file's own name, shown on the pending screen; never sent anywhere. */
  name: string;
  bytes: ArrayBuffer;
}

const DB_NAME = "medpass-offline";
const DB_VERSION = 3;

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
      if (!db.objectStoreNames.contains("conflicts")) db.createObjectStore("conflicts", { keyPath: "clientMutationId" });
      if (!db.objectStoreNames.contains("documentPages")) {
        const store = db.createObjectStore("documentPages", { keyPath: "key" });
        store.createIndex("by-mutation", "clientMutationId");
      }
      if (!db.objectStoreNames.contains("documentIntents")) db.createObjectStore("documentIntents", { keyPath: "clientMutationId" });
    },
  });
  return dbPromise;
}

/** Test-only: forces the next openOfflineDb() call to open a fresh connection. */
export function _resetDbHandleForTests(): void {
  dbPromise = undefined;
}

export type { OfflineSchema, CacheRecord };
