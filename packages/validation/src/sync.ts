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

/** Batch ≤ 50 mutations per docs/15. */
export const syncBatchSchema = z.object({
  cursor: z.string().optional(),
  mutations: z.array(syncMutationEnvelopeSchema).min(1).max(50),
});
export type SyncBatchInput = z.infer<typeof syncBatchSchema>;
