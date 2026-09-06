import { z } from "zod";

/**
 * Batch offline-mutation sync (docs/15 `POST /v1/sync`). Each mutation's
 * `payload` shape depends on `entity`/`operation` — validated per-entity
 * inside SyncService, not here, so an envelope with a payload for an
 * unsupported entity still parses and can be reported as a per-item conflict
 * rather than failing the whole batch with a 400.
 */
export const syncMutationEnvelopeSchema = z.object({
  clientMutationId: z.string().uuid(),
  entity: z.string(),
  operation: z.string(),
  payload: z.unknown(),
  profileId: z.string().uuid(),
  capturedAt: z.string(),
  baseRowVersion: z.number().int().nonnegative().optional(),
});
export type SyncMutationEnvelope = z.infer<typeof syncMutationEnvelopeSchema>;

/**
 * Batch ≤ 50 mutations per docs/15. `mutations` may be empty — a poll purely
 * for incremental server→client changes (docs/15's `changes[]`/cursor
 * stream) still needs a round-trip even when nothing is locally queued.
 * `profileId` scopes that changes computation to the caller's active
 * profile — mutations already carry their own `profileId` each, but an
 * empty batch has none to infer it from.
 */
export const syncBatchSchema = z.object({
  cursor: z.string().optional(),
  profileId: z.string().uuid().optional(),
  mutations: z.array(syncMutationEnvelopeSchema).max(50).default([]),
});
export type SyncBatchInput = z.infer<typeof syncBatchSchema>;

/**
 * Payload of a queued `document_upload_intent/create` (docs_v2/05 §14).
 * Page bytes never travel through `/sync` — the client replays the online
 * sequence itself (create → presigned upload → complete → process) using
 * its clientMutationId as the create's Idempotency-Key, then sends this
 * envelope as the record of the fulfilled intent. The server verifies the
 * named document is whole and processing; a document deleted in the
 * meantime is a `deleted` conflict, one that never finished uploading is
 * `invalid`. The descriptive fields are what the client declared at capture
 * time and are kept for the audit trail only.
 */
export const documentUploadIntentSchema = z.object({
  documentId: z.string().uuid(),
  kind: z.string().trim().max(40).optional(),
  sourceChannel: z.string().trim().max(40).optional(),
  pageCount: z.coerce.number().int().positive().max(30).optional(),
});
export type DocumentUploadIntentInput = z.infer<typeof documentUploadIntentSchema>;
