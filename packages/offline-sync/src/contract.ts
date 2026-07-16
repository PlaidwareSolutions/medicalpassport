/**
 * Offline mutation contract shared by the PWA (and native apps later) and
 * the API's per-action idempotent endpoints (docs/15). Stage 5 scope: only
 * `dose_event` mutations are actually queued offline this pass — recording
 * whether a dose was taken is the single highest-value offline action
 * (product vision goal 5). Other entities are defined for forward
 * compatibility but not yet produced by any client code.
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
  /** Which endpoint to replay this against (Stage 5 simplification — see docs/15 note in README). */
  endpoint: string;
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
