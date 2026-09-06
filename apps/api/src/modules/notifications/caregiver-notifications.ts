import { writeAudit } from "@medpass/audit";
import { PROFILE_SCOPE_GRANTS, type ProfileAction } from "@medpass/authorization";
import type { CaregiverNotificationKind } from "@medpass/domain";
import type { Prisma, PrismaClient } from "@medpass/database";

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Caregiver-facing notification kinds (docs_v2/06 P6-4, docs_v2/04 §12) and
 * the profile action a caregiver must hold to receive each one. The scope
 * list is *derived* from the authorization matrix rather than copied: a
 * caregiver is told about a new prescription exactly when they could open
 * it themselves, and the cron's recipient resolution reads the same map,
 * so the two can never disagree about who is entitled to hear.
 *
 * `unusual_measurement` is deliberately not here (hazard H-41): no
 * threshold-based alert ships until a Safety-Board-approved rule exists.
 */
export const CAREGIVER_NOTIFICATION_ACTION: Readonly<Record<CaregiverNotificationKind, ProfileAction>> = {
  new_prescription: "view_medications",
  new_test_result: "view_tests",
  refill_low: "view_medications",
};

export function caregiverScopesFor(kind: CaregiverNotificationKind) {
  return PROFILE_SCOPE_GRANTS[CAREGIVER_NOTIFICATION_ACTION[kind]];
}

export interface QueueCaregiverNotificationInput {
  patientProfileId: string;
  kind: CaregiverNotificationKind;
  /** The source row; part of the dedupe key so a retried create never queues twice. */
  entityId: string;
  /** Whose action produced this — never a recipient of it. */
  triggeredByUserId: string;
  triggeredByRole: "patient" | "caregiver";
  patientMedicationId?: string | null;
  correlationId?: string;
}

/**
 * Queues one caregiver-facing `Notification` for the every-minute dispatch
 * pass in apps/cron (detect-due-reminders → dispatchPendingNotifications),
 * inside the caller's transaction so a failed clinical write never leaves a
 * phantom "new prescription" behind.
 *
 * Only queued when at least one *other* active caregiver holds a granting
 * scope — most profiles have no caregivers at all, and a row nobody could
 * ever receive is just noise for the dispatcher to cancel. Recipients are
 * resolved again at dispatch time, so a scope revoked between the two
 * moments is honoured (docs/18: revocation is immediate).
 */
export async function queueCaregiverNotification(tx: Tx, input: QueueCaregiverNotificationInput): Promise<{ id: string } | null> {
  const eligible = await tx.caregiverRelationship.count({
    where: {
      patientProfileId: input.patientProfileId,
      status: "active",
      caregiverUserId: { not: null, notIn: [input.triggeredByUserId] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      permissions: { some: { scope: { in: [...caregiverScopesFor(input.kind)] }, revokedAt: null } },
    },
  });
  if (eligible === 0) return null;

  const dedupeKey = `${input.kind}:${input.entityId}`;
  const existing = await tx.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
  if (existing) return existing;

  const pref = await tx.notificationPreference.findUnique({
    where: { patientProfileId: input.patientProfileId },
    select: { privacyMode: true },
  });
  const created = await tx.notification.create({
    data: {
      patientProfileId: input.patientProfileId,
      kind: input.kind,
      patientMedicationId: input.patientMedicationId ?? null,
      privacyMode: pref?.privacyMode ?? "generic",
      dedupeKey,
      status: "pending",
      triggeredByUserId: input.triggeredByUserId,
    },
    select: { id: true },
  });
  await writeAudit(tx, {
    action: "notification.caregiver_queued",
    actorUserId: input.triggeredByUserId,
    actorType: input.triggeredByRole,
    entityType: "notification",
    entityId: created.id,
    patientProfileId: input.patientProfileId,
    correlationId: input.correlationId,
    // The kind is not PHI; the source entity id is carried by the dedupe key, not here.
    context: { kind: input.kind, eligibleCaregivers: eligible },
  });
  return created;
}
