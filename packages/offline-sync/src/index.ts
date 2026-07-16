/**
 * Offline mutation contract shared by the PWA (and native apps later) and the
 * API's /v1/sync endpoint. Full client implementation lands in Stage 5
 * (docs/15); the wire format is fixed now so Stage 2 writes are already
 * idempotent via clientMutationId.
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

export type SyncStatus =
  | "online"
  | "offline"
  | "syncing"
  | "sync_failed"
  | "changes_pending";

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
