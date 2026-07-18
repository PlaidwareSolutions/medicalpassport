import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ERROR_CODES } from "@medpass/domain";
import { createMedicationSchema, recordDoseEventSchema, updateMedicationSchema, type SyncMutationEnvelope } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { ProfileAccessService } from "../../common/profile-access.service";
import { IdempotencyService } from "../../common/idempotency.service";
import { MedicationsService } from "../medications/medications.service";
import { TimelineService } from "../scheduling/timeline.service";

export interface SyncConflict {
  clientMutationId: string;
  kind: "row_version" | "deleted" | "permission_revoked" | "invalid";
  serverState?: unknown;
}

export interface SyncResult {
  applied: string[];
  conflicts: SyncConflict[];
  changes: unknown[];
  nextCursor: string;
}

const uuid = z.string().uuid();

/**
 * Which caregiver permission scope a mutation needs, keyed by entity+operation
 * (docs/18) — undefined means the combination isn't offline-capable yet, so
 * it's reported as an "invalid" conflict rather than guessed at.
 */
function requiredActionFor(entity: string, operation: string) {
  if (entity === "dose_event" && operation === "create") return "record_doses" as const;
  if (entity === "patient_medication" && operation === "create") return "add_medications" as const;
  if (entity === "patient_medication" && operation === "update") return "edit_medications" as const;
  return undefined;
}

/**
 * `POST /v1/sync` (docs/15): the single endpoint every offline-capable
 * mutation replays through, dispatched internally by entity+operation rather
 * than each mutation carrying its own REST path. Only the entities this
 * codebase actually has real create/update logic for are dispatched —
 * dose_event and patient_medication — everything else in the wider
 * OfflineMutation contract (patient_profile, allergy, condition,
 * medication_instruction as its own entity) isn't offline-capable yet and
 * comes back as an "invalid" conflict, never silently dropped.
 *
 * Mutations apply strictly in the order given (docs/15 — per-entity
 * ordering) and one mutation's failure never aborts the rest of the batch;
 * each outcome (applied or a specific conflict) is reported per item.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly idempotency: IdempotencyService,
    private readonly medications: MedicationsService,
    private readonly timeline: TimelineService,
  ) {}

  async apply(userId: string, mutations: SyncMutationEnvelope[], correlationId?: string): Promise<SyncResult> {
    const applied: string[] = [];
    const conflicts: SyncConflict[] = [];

    for (const mutation of mutations) {
      const outcome = await this.applyOne(userId, mutation, correlationId);
      if (outcome) conflicts.push({ clientMutationId: mutation.clientMutationId, ...outcome });
      else applied.push(mutation.clientMutationId);
    }

    return { applied, conflicts, changes: [], nextCursor: new Date().toISOString() };
  }

  private async applyOne(
    userId: string,
    mutation: SyncMutationEnvelope,
    correlationId?: string,
  ): Promise<Omit<SyncConflict, "clientMutationId"> | undefined> {
    const action = requiredActionFor(mutation.entity, mutation.operation);
    if (!action) return { kind: "invalid" };

    let actorRole: "patient" | "caregiver";
    try {
      ({ actorRole } = await this.access.requireForProfile(userId, mutation.profileId, action, correlationId));
    } catch {
      return { kind: "permission_revoked" };
    }
    const actor = { userId, actorRole, correlationId };

    try {
      if (mutation.entity === "dose_event") {
        const scheduledDoseId = uuid.parse((mutation.payload as { scheduledDoseId?: unknown })?.scheduledDoseId);
        const input = recordDoseEventSchema.parse(mutation.payload);
        await this.timeline.recordDoseEvent(mutation.profileId, scheduledDoseId, input, actor);
        return undefined;
      }

      if (mutation.operation === "create") {
        const input = createMedicationSchema.parse(mutation.payload);
        await this.idempotency.run({
          key: mutation.clientMutationId,
          userId,
          profileId: mutation.profileId,
          entity: "patient_medication",
          operation: "create",
          requestDigestSource: mutation.payload,
          execute: () => this.medications.create(mutation.profileId, input, actor),
        });
        return undefined;
      }

      const id = uuid.parse((mutation.payload as { id?: unknown })?.id);
      const input = updateMedicationSchema.parse(mutation.payload);
      // Digest excludes `id` (a routing detail, not part of the edit) so it
      // matches whatever a direct PATCH with the same Idempotency-Key would
      // have hashed — a client that tries PATCH online first and falls back
      // to queuing this same clientMutationId on a network failure must
      // resolve to the same ledger entry either way.
      const { id: _id, ...bodyLikePayload } = mutation.payload as Record<string, unknown>;
      try {
        await this.idempotency.run({
          key: mutation.clientMutationId,
          userId,
          profileId: mutation.profileId,
          entity: "patient_medication",
          operation: "update",
          requestDigestSource: bodyLikePayload,
          execute: () => this.medications.update(mutation.profileId, id, input, actor),
        });
        return undefined;
      } catch (err) {
        if (err instanceof ApiProblem && err.code === ERROR_CODES.CONFLICT_ROW_VERSION) {
          const serverState = await this.medications.byId(mutation.profileId, id);
          return { kind: serverState ? "row_version" : "deleted", serverState };
        }
        throw err;
      }
    } catch {
      // Validation failures, not-found, etc. — reported, never thrown to abort the batch.
      return { kind: "invalid" };
    }
  }
}
