/**
 * Offline mutation contract shared by the PWA (and native apps later) and
 * the API's `POST /v1/sync` batch endpoint (docs/15), which dispatches each
 * mutation by `entity`+`operation` rather than a per-mutation URL. Queued
 * this pass: `dose_event` and `patient_medication` (create/update) — the
 * other entities are defined for forward compatibility but not yet produced
 * by any client code or dispatched server-side.
 */

export type SyncEntity =
  | "dose_event"
  | "patient_medication"
  | "medication_instruction"
  | "patient_profile"
  | "allergy"
  | "condition";

export type SyncOperation = "create" | "update" | "status_change" | "soft_delete";

export interface OfflineMutation<TPayload = unknown> {
  /** UUID generated at capture time; retries reuse it (exactly-once apply). */
  clientMutationId: string;
  entity: SyncEntity;
  operation: SyncOperation;
  payload: TPayload;
  baseRowVersion?: number;
  capturedAt: string;
  profileId: string;
}

export type SyncStatus = "online" | "offline" | "syncing" | "sync_failed" | "changes_pending";

export interface SyncConflict {
  clientMutationId: string;
  kind: "row_version" | "deleted" | "permission_revoked" | "invalid";
  serverState?: unknown;
}

export interface SyncResponse {
  applied: string[];
  conflicts: SyncConflict[];
  changes: unknown[];
  nextCursor: string;
}
