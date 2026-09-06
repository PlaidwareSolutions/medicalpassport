import type { ProfileAction } from "@medpass/authorization";
import type { SyncEntity, SyncOperation } from "@medpass/offline-sync";

/**
 * Every (entity, operation) pair `POST /v1/sync` dispatches, with the
 * caregiver permission scope each needs (docs/18). This is the server's
 * side of the contract in `@medpass/offline-sync` (`SYNC_MUTATIONS`): a unit
 * test asserts the two sets are identical, so a pair added on either side
 * without the other fails CI (docs_v2/06 P0-8).
 *
 * Kept decorator-free so the drift test can import it without booting Nest.
 * Typing `entity`/`operation` with the contract's unions means the API can't
 * even name a pair the contract lacks; the test guards the other direction.
 */
export const DISPATCHED_SYNC_MUTATIONS = [
  { entity: "dose_event", operation: "create", action: "record_doses" },
  { entity: "patient_medication", operation: "create", action: "add_medications" },
  { entity: "patient_medication", operation: "update", action: "edit_medications" },
  // docs_v2/05 §14 — same scopes the direct endpoints require.
  { entity: "observation", operation: "create", action: "add_measurements" },
  { entity: "document_upload_intent", operation: "create", action: "upload_documents" },
] as const satisfies readonly { entity: SyncEntity; operation: SyncOperation; action: ProfileAction }[];

/**
 * Which caregiver permission scope a mutation needs, keyed by
 * entity+operation — undefined means the combination isn't offline-capable,
 * so it's reported as an "invalid" conflict rather than guessed at.
 */
export function requiredActionFor(entity: string, operation: string): ProfileAction | undefined {
  return DISPATCHED_SYNC_MUTATIONS.find((d) => d.entity === entity && d.operation === operation)?.action;
}
