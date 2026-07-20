import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ERROR_CODES } from "@medpass/domain";
import {
  createMedicationSchema,
  recordDoseEventSchema,
  updateMedicationSchema,
  type SyncMutationEnvelope,
  type UpdateMedicationInput,
} from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { ProfileAccessService } from "../../common/profile-access.service";
import { IdempotencyService } from "../../common/idempotency.service";
import { PrismaService } from "../../common/prisma.service";
import { MedicationsService } from "../medications/medications.service";
import { TimelineService } from "../scheduling/timeline.service";

export interface SyncConflict {
  clientMutationId: string;
  kind: "row_version" | "field_conflict" | "deleted" | "permission_revoked" | "invalid";
  serverState?: unknown;
  unmergedFields?: string[];
}

export interface SyncChangeSignal {
  profileId: string;
  scope: "medications" | "timeline";
  dates?: string[];
}

export interface SyncResult {
  applied: string[];
  conflicts: SyncConflict[];
  changes: SyncChangeSignal[];
  nextCursor: string;
}

const uuid = z.string().uuid();

/** Non-clinical fields a `patient_medication` edit can touch — safe to auto-merge on a conflict (docs/15). */
const SAFE_MEDICATION_FIELDS = ["patientReason", "prescriberName", "endDate", "quantityOnHand", "criticalEscalation"] as const;

function hasAnySafeField(input: UpdateMedicationInput): boolean {
  return SAFE_MEDICATION_FIELDS.some((f) => input[f] !== undefined);
}

function safeFieldsOnly(input: UpdateMedicationInput): UpdateMedicationInput {
  const out: UpdateMedicationInput = { rowVersion: input.rowVersion };
  for (const f of SAFE_MEDICATION_FIELDS) if (input[f] !== undefined) (out as Record<string, unknown>)[f] = input[f];
  return out;
}

/** Fixed +05:30 offset — matches the scheduling engine's Asia/Kolkata simplification (docs/16). */
function istDate(date: Date): string {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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
 *
 * A batch may also be empty — this is a valid call purely to pull
 * incremental server→client changes (`changes[]`/`cursor`, docs/15) for
 * `profileId`, e.g. a caregiver's edit that happened while this device was
 * offline. Changes are *invalidation signals*, not row patches: this app
 * always re-fetches whole lists fresh (docs/12 H-12), so "medications" or
 * "timeline" (with the affected dates) is enough for a listening screen to
 * know it should reload — not what specifically changed.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly access: ProfileAccessService,
    private readonly idempotency: IdempotencyService,
    private readonly medications: MedicationsService,
    private readonly timeline: TimelineService,
    private readonly prisma: PrismaService,
  ) {}

  async apply(userId: string, mutations: SyncMutationEnvelope[], cursor: string | undefined, profileId: string | undefined, correlationId?: string): Promise<SyncResult> {
    const nextCursor = new Date().toISOString();
    const applied: string[] = [];
    const conflicts: SyncConflict[] = [];

    for (const mutation of mutations) {
      const outcome = await this.applyOne(userId, mutation, correlationId);
      if (outcome) conflicts.push({ clientMutationId: mutation.clientMutationId, ...outcome });
      else applied.push(mutation.clientMutationId);
    }

    const changes = profileId ? await this.computeChanges(userId, profileId, cursor, correlationId) : [];
    return { applied, conflicts, changes, nextCursor };
  }

  /**
   * Invalidation signals only, never row patches (see class doc). No cursor
   * (a device's first-ever sync) reports nothing — there's no "since" to
   * measure from, and flooding a fresh device with "everything changed"
   * would be noise, not signal; its own initial screen loads already fetch
   * live data directly.
   */
  private async computeChanges(userId: string, profileId: string, cursor: string | undefined, correlationId?: string): Promise<SyncChangeSignal[]> {
    if (!cursor) return [];
    try {
      await this.access.requireForProfile(userId, profileId, "view_medications", correlationId);
    } catch {
      return []; // revoked/no access — nothing to report, not a hard error for a background poll
    }

    const since = new Date(cursor);
    if (Number.isNaN(since.getTime())) return [];
    const changes: SyncChangeSignal[] = [];

    const medChanged = await this.prisma.patientMedication.findFirst({
      where: { patientProfileId: profileId, updatedAt: { gt: since } },
      select: { id: true },
    });
    if (medChanged) changes.push({ profileId, scope: "medications" });

    const [changedDoses, changedEvents] = await Promise.all([
      this.prisma.scheduledDose.findMany({
        where: { medicationSchedule: { patientMedication: { patientProfileId: profileId } }, updatedAt: { gt: since } },
        select: { dueAt: true },
      }),
      this.prisma.doseEvent.findMany({
        where: { patientMedication: { patientProfileId: profileId }, effectiveAt: { gt: since } },
        select: { effectiveAt: true },
      }),
    ]);
    const dates = new Set<string>();
    for (const d of changedDoses) dates.add(istDate(d.dueAt));
    for (const e of changedEvents) dates.add(istDate(e.effectiveAt));
    if (dates.size > 0) changes.push({ profileId, scope: "timeline", dates: [...dates] });

    return changes;
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
          return this.mergeMedicationConflict(mutation.profileId, id, input, actor);
        }
        throw err;
      }
    } catch {
      // Validation failures, not-found, etc. — reported, never thrown to abort the batch.
      return { kind: "invalid" };
    }
  }

  /**
   * Field-level disjoint merge for a `patient_medication` update conflict
   * (docs/15): non-clinical fields (reason, prescriber, end date, supply,
   * the critical-escalation flag) are safe to re-apply against whatever the
   * row's current state is — a caregiver renaming the prescriber and the
   * patient updating their supply count aren't in genuine conflict with
   * each other. `instruction` (dose/frequency/food) is the one
   * clinical-safety field docs/15 says must never silently merge — a pure
   * instruction-only edit gets no merge attempt at all (server wins
   * outright); an edit that also touched safe fields gets those applied
   * and only the instruction change reported as unmerged.
   *
   * There's no per-field version history to detect true disjointness
   * against whatever the *other* edit touched — this deliberately doesn't
   * pretend to reconstruct that. The real guarantee here is narrower and
   * honest: these specific fields are never clinically contested, so
   * re-applying them against the latest row is always safe regardless of
   * what else changed.
   */
  private async mergeMedicationConflict(
    profileId: string,
    id: string,
    input: UpdateMedicationInput,
    actor: { userId: string; actorRole: "patient" | "caregiver"; correlationId?: string },
  ): Promise<Omit<SyncConflict, "clientMutationId"> | undefined> {
    const current = await this.medications.byId(profileId, id);
    if (!current) return { kind: "deleted" };

    if (!input.instruction) {
      // Nothing clinical in this edit — safe to retry wholesale.
      try {
        await this.medications.update(profileId, id, { ...input, rowVersion: current.rowVersion }, actor);
        return undefined;
      } catch {
        return { kind: "row_version", serverState: current };
      }
    }

    if (!hasAnySafeField(input)) {
      // Pure clinical edit — no partial merge possible; server wins (docs/15).
      return { kind: "row_version", serverState: current };
    }

    try {
      await this.medications.update(profileId, id, { ...safeFieldsOnly(input), rowVersion: current.rowVersion }, actor);
      const merged = await this.medications.byId(profileId, id);
      return { kind: "field_conflict", serverState: merged, unmergedFields: ["instruction"] };
    } catch {
      return { kind: "row_version", serverState: current };
    }
  }
}
