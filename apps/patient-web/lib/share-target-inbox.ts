/**
 * Web Share Target handoff (docs_v2/09 §3). The service worker receives the
 * share sheet's multipart POST, parks the files here, and redirects to the
 * `/share-target` screen, which asks WHICH PROFILE they belong to before
 * anything is uploaded (docs_v2/10 H-38 — nothing auto-attached).
 *
 * IndexedDB, not the Cache API: a shared document is PHI, and docs/15 keeps
 * PHI out of every service-worker cache. The inbox is transient — the
 * capture screen drains it the moment it reads the files — and a stale
 * entry can only ever surface as "these files were shared earlier", never
 * as a record.
 *
 * No `"use client"` directive and no DOM imports: this module is bundled
 * into the service worker (app/sw.ts) as well as the pages.
 */

const DB_NAME = "medpass-share-target";
const STORE = "inbox";

interface InboxEntry {
  key: number;
  name: string;
  type: string;
  blob: Blob;
  receivedAt: number;
}

function openInbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_open_failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb_tx_failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb_tx_aborted"));
  });
}

/** Replaces whatever was parked before — a share is a fresh intent, never an append. */
export async function putSharedFiles(files: File[]): Promise<void> {
  const db = await openInbox();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.clear();
    files.forEach((file, index) => {
      const entry: InboxEntry = { key: index, name: file.name, type: file.type, blob: file, receivedAt: Date.now() };
      store.put(entry);
    });
    await done(tx);
  } finally {
    db.close();
  }
}

export async function readSharedFiles(): Promise<File[]> {
  const db = await openInbox();
  try {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    const entries = await new Promise<InboxEntry[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as InboxEntry[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error("indexeddb_read_failed"));
    });
    return entries
      .sort((a, b) => a.key - b.key)
      .map((e) => new File([e.blob], e.name || `shared-${e.key + 1}`, { type: e.type || e.blob.type }));
  } finally {
    db.close();
  }
}

export async function clearSharedFiles(): Promise<void> {
  const db = await openInbox();
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await done(tx);
  } finally {
    db.close();
  }
}
