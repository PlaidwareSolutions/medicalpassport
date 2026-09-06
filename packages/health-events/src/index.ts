import type { Prisma, PrismaClient } from "@medpass/database";
import type {
  HealthEventActorType,
  HealthEventKind,
  RecordSource,
  VerificationState,
} from "@medpass/database";

export * from "./projectors";
export { localIso } from "./local-time";

/**
 * @medpass/health-events — the timeline projection (docs_v2/04 §9,
 * ADR-V2-008). Call `emitHealthEvent` inside the same transaction as the
 * clinical write it describes, exactly like `writeAudit`. The table is a read
 * model: append-only, idempotent on (entityType, entityId, kind, occurredAt),
 * never a source of truth.
 */

type Tx = PrismaClient | Prisma.TransactionClient;

export interface HealthEventInput {
  patientProfileId: string;
  kind: HealthEventKind;
  entityType: string;
  entityId: string;
  occurredAt: Date;
  /** ISO local date-time in the patient's zone; use `localIso(occurredAt, timezone)`. */
  occurredAtLocal?: string | null;
  /** Locale-neutral, PHI-minimal structured summary the UI renders with its own copy. */
  summary: Record<string, unknown>;
  encounterId?: string | null;
  actorUserId?: string | null;
  actorType?: HealthEventActorType;
  provenanceSource?: RecordSource | null;
  verification?: VerificationState | null;
}

/**
 * Appends (or, on an exact key replay, refreshes) one event. Idempotent so a
 * retried request or a re-run backfill never duplicates a timeline entry.
 */
export async function emitHealthEvent(tx: Tx, input: HealthEventInput): Promise<{ id: string }> {
  const row = await tx.healthEvent.upsert({
    where: {
      entityType_entityId_kind_occurredAt: {
        entityType: input.entityType,
        entityId: input.entityId,
        kind: input.kind,
        occurredAt: input.occurredAt,
      },
    },
    create: {
      patientProfileId: input.patientProfileId,
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      occurredAt: input.occurredAt,
      occurredAtLocal: input.occurredAtLocal ?? null,
      summary: input.summary as Prisma.InputJsonValue,
      encounterId: input.encounterId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType ?? "patient",
      provenanceSource: input.provenanceSource ?? null,
      verification: input.verification ?? null,
    },
    update: {
      summary: input.summary as Prisma.InputJsonValue,
      encounterId: input.encounterId ?? null,
      provenanceSource: input.provenanceSource ?? null,
      verification: input.verification ?? null,
      supersededAt: null,
    },
    select: { id: true },
  });
  return row;
}

/**
 * Marks every live event of an entity as superseded (the source row was
 * corrected or deleted). The caller then emits the replacement event, if any.
 * Events are never deleted.
 */
export async function supersedeHealthEvents(
  tx: Tx,
  entityType: string,
  entityId: string,
  at: Date = new Date(),
): Promise<number> {
  const result = await tx.healthEvent.updateMany({
    where: { entityType, entityId, supersededAt: null },
    data: { supersededAt: at },
  });
  return result.count;
}

/** Convenience: emit several events in one go (same transaction). */
export async function emitHealthEvents(tx: Tx, inputs: HealthEventInput[]): Promise<void> {
  for (const input of inputs) await emitHealthEvent(tx, input);
}
