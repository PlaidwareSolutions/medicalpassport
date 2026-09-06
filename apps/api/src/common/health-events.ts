import type { Prisma, PrismaClient, RecordSource, VerificationState } from "@medpass/database";
import { emitHealthEvent, projectMedicationChange } from "@medpass/health-events";

/**
 * Thin API-side glue over @medpass/health-events (ADR-V2-008): every clinical
 * write calls `emitHealthEvent` inside its own transaction, exactly like
 * `writeAudit`. The patient's `timezone` (never the viewer's — docs/16)
 * anchors `occurredAtLocal`.
 */
type Tx = PrismaClient | Prisma.TransactionClient;

export type EventActorType = "patient" | "caregiver";

export interface EventCtx {
  patientProfileId: string;
  timezone: string;
  actorUserId?: string | null;
  actorType?: EventActorType;
}

export async function profileTimezone(tx: Tx, profileId: string): Promise<string> {
  const profile = await tx.patientProfile.findUnique({ where: { id: profileId }, select: { timezone: true } });
  return profile?.timezone ?? "Asia/Kolkata";
}

export async function eventCtx(
  tx: Tx,
  profileId: string,
  actor: { userId: string; actorRole: EventActorType },
): Promise<EventCtx> {
  return {
    patientProfileId: profileId,
    timezone: await profileTimezone(tx, profileId),
    actorUserId: actor.userId,
    actorType: actor.actorRole,
  };
}

/**
 * One `MedicationChange` row → one timeline event. Every code path that
 * appends a change (create, edit, status, dose-unit correction, refill,
 * link, delete) calls this in the same transaction.
 */
export async function emitMedicationChangeEvent(
  tx: Tx,
  params: {
    profileId: string;
    actorType: EventActorType;
    medication: {
      id: string;
      enteredName: string;
      provenanceSource?: RecordSource | null;
      verification?: VerificationState | null;
      recordedByUserId?: string | null;
    };
    change: { id: string; change: string; detail: unknown; actorUserId: string; occurredAt: Date };
  },
): Promise<void> {
  const timezone = await profileTimezone(tx, params.profileId);
  const detail =
    params.change.detail && typeof params.change.detail === "object" && !Array.isArray(params.change.detail)
      ? (params.change.detail as Record<string, unknown>)
      : null;
  await emitHealthEvent(
    tx,
    projectMedicationChange(
      { patientProfileId: params.profileId, timezone, actorType: params.actorType },
      params.medication,
      { ...params.change, detail },
    ),
  );
}
