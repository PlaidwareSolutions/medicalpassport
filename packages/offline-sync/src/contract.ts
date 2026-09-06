/**
 * Offline mutation contract shared by the PWA (and native apps later) and
 * the API's `POST /v1/sync` batch endpoint (docs/15), which dispatches each
 * mutation by `entity`+`operation` rather than a per-mutation URL.
 *
 * `SYNC_MUTATIONS` is the single runtime source of truth for which
 * (entity, operation) pairs exist. It lists exactly what the server
 * dispatches — nothing "for forward compatibility": a pair the server can't
 * apply would sit in a device's queue forever as an `invalid` conflict, so
 * the contract is kept honest by a unit test in `apps/api` that asserts this
 * set equals the dispatcher's (docs_v2/06 P0-8). Adding a pair here without
 * a server handler fails CI, and vice versa.
 */
export const SYNC_MUTATIONS = [
  { entity: "dose_event", operation: "create" },
  { entity: "patient_medication", operation: "create" },
  { entity: "patient_medication", operation: "update" },
  // docs_v2/05 §14: a home measurement captured offline; the server keys
  // the row on clientMutationId so a replay never double-inserts.
  { entity: "observation", operation: "create" },
  // docs_v2/05 §14: a document captured offline. The page bytes stay in
  // IndexedDB (see documents.ts); the client replays the online create →
  // upload → complete → process sequence itself, and this envelope — sent
  // afterwards with the resulting `documentId` — is the record that the
  // intent was fulfilled (or the `deleted` / `invalid` conflict if not).
  { entity: "document_upload_intent", operation: "create" },
] as const satisfies readonly { entity: string; operation: string }[];

/**
 * What the capture screen queues for a document (docs_v2/05 §14). Only the
 * declaration lives here — the bytes are in the `documentPages` store keyed
 * by the same clientMutationId, and the replay's progress (the document id
 * once created, the pages already complete) in `documentIntents`, so the
 * payload itself never changes between attempts.
 */
export interface DocumentUploadIntentPayload {
  /** The kind the person declared at capture time (the classifier may never re-label it). */
  kind?: string;
  title?: string;
  sourceChannel: string;
  pages: Array<{ pageNumber: number; contentType: string; sizeBytes: number }>;
  /** At most one clinical parent, as the create endpoint takes them. */
  prescriptionId?: string;
  diagnosticReportId?: string;
  /** Set only on the envelope that finally goes to `/sync`, once the upload sequence has run. */
  documentId?: string;
}

/** Replay bookkeeping for one queued document intent — separate from the payload so the payload stays immutable. */
export interface DocumentIntentProgress {
  clientMutationId: string;
  profileId: string;
  /** Set once the create call succeeded; a retry resumes on this document rather than creating another. */
  documentId?: string;
  /** Page numbers whose upload + complete both succeeded. */
  completedPages: number[];
  status: "queued" | "uploading" | "failed";
  updatedAt: string;
}

/** One dispatchable (entity, operation) pair. */
export type SyncMutationKind = (typeof SYNC_MUTATIONS)[number];
export type SyncEntity = SyncMutationKind["entity"];
export type SyncOperation = SyncMutationKind["operation"];

/** Canonical `entity:operation` key, used to compare contract and dispatcher as sets. */
export function syncMutationKey(kind: { entity: string; operation: string }): string {
  return `${kind.entity}:${kind.operation}`;
}

const SYNC_MUTATION_KEYS: ReadonlySet<string> = new Set(SYNC_MUTATIONS.map(syncMutationKey));

/** Whether an (entity, operation) pair is one the server dispatches. */
export function isSyncMutationKind(kind: { entity: string; operation: string }): kind is SyncMutationKind {
  return SYNC_MUTATION_KEYS.has(syncMutationKey(kind));
}

/**
 * A queued mutation. The `entity`/`operation` pair is constrained to
 * `SyncMutationKind`, so client code can only enqueue what the server
 * applies — `enqueueMutation` also guards this at runtime.
 */
export type OfflineMutation<TPayload = unknown> = SyncMutationKind & {
  /** UUID generated at capture time; retries reuse it (exactly-once apply). */
  clientMutationId: string;
  payload: TPayload;
  baseRowVersion?: number;
  capturedAt: string;
  profileId: string;
};

export type SyncStatus = "online" | "offline" | "syncing" | "sync_failed" | "changes_pending";

export interface SyncConflict {
  clientMutationId: string;
  kind: "row_version" | "field_conflict" | "deleted" | "permission_revoked" | "invalid";
  serverState?: unknown;
  /**
   * Set only for `field_conflict`: the fields the client tried to change
   * that couldn't be safely auto-merged (docs/15 — clinical-safety fields
   * like dose/frequency always need explicit re-confirmation, never a
   * silent merge). Every other field in the same mutation was applied.
   */
  unmergedFields?: string[];
}

/**
 * An invalidation signal, not a row-level patch (docs/15's `changes[]`) —
 * this app always re-fetches whole lists fresh from the server rather than
 * patching cached records field-by-field, so "something changed" is enough
 * to tell a listening screen to reload; it doesn't need to say what.
 */
export interface SyncChangeSignal {
  profileId: string;
  scope: "medications" | "timeline" | "observations" | "documents";
  /** Only set for `scope: "timeline"` — IST calendar dates (YYYY-MM-DD) affected. */
  dates?: string[];
}

export interface SyncResponse {
  applied: string[];
  conflicts: SyncConflict[];
  changes: SyncChangeSignal[];
  nextCursor: string;
}
