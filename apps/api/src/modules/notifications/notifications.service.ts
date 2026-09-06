import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { dailySlotQuantity, type SlotDose } from "@medpass/medication-terminology";
import {
  CAREGIVER_ALERT_MAX_ITEMS,
  CAREGIVER_ALERT_WINDOW_DAYS,
  ERROR_CODES,
  MEASUREMENT_REMINDERS_JSON_KEY,
  NOTIFICATION_CHANNELS,
  OBSERVATION_CONCEPTS,
  type AuditActorType,
  type NotificationChannel,
} from "@medpass/domain";
import type { ChannelFrequencyInput, MeasurementRemindersInput, NotificationPreferencesInput, WebPushSubscribeInput } from "@medpass/validation";
// A value import, not type-only: clearing the reminder plan needs Prisma.DbNull.
import { Prisma } from "@medpass/database";
import { ApiProblem } from "../../common/errors";
import { encryptField, sha256Hex } from "../../common/crypto";
import { env } from "../../common/env";
import { PrismaService } from "../../common/prisma.service";

interface Actor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
}

/** Tolerant read of the stored JSON: anything malformed reads as "no control set", never as a 500 on the settings screen. */
export function readChannelFrequency(raw: unknown): ChannelFrequencyInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ChannelFrequencyInput = {};
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as { channels?: unknown; frequency?: unknown };
    if (!Array.isArray(entry.channels) || typeof entry.frequency !== "string") continue;
    out[kind] = {
      channels: entry.channels.filter((c): c is NotificationChannel => (NOTIFICATION_CHANNELS as readonly unknown[]).includes(c)),
      frequency: entry.frequency as ChannelFrequencyInput[string]["frequency"],
    };
  }
  return out;
}

/**
 * Tolerant read of the measurement-reminder plan (P17). The plan has its own
 * column now; a plan written before that column existed sat under a reserved
 * key inside `channelFrequencyJson`, so both shapes are accepted — pass
 * either column's value. Mirrors apps/cron/src/lib/measurement-reminders.ts
 * `readMeasurementReminders`.
 */
export function readMeasurementReminders(raw: unknown): MeasurementRemindersInput {
  const out: MeasurementRemindersInput = { concepts: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const asRecord = raw as Record<string, unknown>;
  const reserved = MEASUREMENT_REMINDERS_JSON_KEY in asRecord ? asRecord[MEASUREMENT_REMINDERS_JSON_KEY] : asRecord;
  if (!reserved || typeof reserved !== "object" || Array.isArray(reserved)) return out;
  const concepts = (reserved as { concepts?: unknown }).concepts;
  if (!concepts || typeof concepts !== "object" || Array.isArray(concepts)) return out;
  for (const [concept, plan] of Object.entries(concepts as Record<string, unknown>)) {
    if (!(OBSERVATION_CONCEPTS as readonly string[]).includes(concept)) continue;
    if (!plan || typeof plan !== "object") continue;
    const { times, days } = plan as { times?: unknown; days?: unknown };
    if (!Array.isArray(times) || !Array.isArray(days)) continue;
    out.concepts[concept as keyof MeasurementRemindersInput["concepts"]] = {
      times: times.filter((t): t is string => typeof t === "string"),
      days: days.filter((d): d is number => Number.isInteger(d)),
    };
  }
  return out;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  vapidPublicKey(): { publicKey: string | null } {
    return { publicKey: env().VAPID_PUBLIC_KEY ?? null };
  }

  /**
   * A push subscription belongs to the signed-in user's browser, not any one
   * profile (docs/13 notification_channels) — one device can carry reminders
   * for every profile that user owns. Re-subscribing the same endpoint (e.g.
   * after the browser rotated keys) replaces the row rather than erroring.
   */
  async subscribeWebPush(userId: string, input: WebPushSubscribeInput) {
    const endpointDigest = sha256Hex(input.endpoint);
    const addressCiphertext = encryptField(JSON.stringify(input));
    await this.prisma.notificationChannel.upsert({
      where: { endpointDigest },
      create: { userId, channel: "web_push", addressCiphertext, endpointDigest, status: "active" },
      update: { userId, addressCiphertext, status: "active" },
    });
    return { subscribed: true as const };
  }

  async unsubscribeWebPush(userId: string, endpoint: string) {
    const endpointDigest = sha256Hex(endpoint);
    await this.prisma.notificationChannel.updateMany({
      where: { endpointDigest, userId },
      data: { status: "revoked" },
    });
    return { unsubscribed: true as const };
  }

  async getPreferences(profileId: string) {
    const pref = await this.prisma.notificationPreference.findUnique({ where: { patientProfileId: profileId } });
    return {
      pushEnabled: pref?.pushEnabled ?? false,
      privacyMode: pref?.privacyMode ?? "generic",
      quietHoursEnabled: pref?.quietHoursEnabled ?? true,
      quietHoursStart: pref?.quietHoursStart ?? "22:00",
      quietHoursEnd: pref?.quietHoursEnd ?? "07:00",
      soundEnabled: pref?.soundEnabled ?? true,
      vibrationEnabled: pref?.vibrationEnabled ?? true,
      // Per-kind {channels[], frequency} (docs_v2/04 §12). An absent kind
      // means "immediate on every channel the profile has" — the V1
      // behaviour — so the default is an empty map, not a filled-in one.
      channelFrequency: readChannelFrequency(pref?.channelFrequencyJson),
    };
  }

  /**
   * Full replace (POST and PUT share this). `channelFrequency` is only
   * touched when the body carries it, so the V1 PWA's POST — which never
   * sends the key — cannot wipe a control the patient set on the new
   * screen. `dose_reminder`/`caregiver_escalation` entries are refused by
   * the schema (hazard H-48), and the dispatch cron ignores them anyway.
   */
  async updatePreferences(profileId: string, input: NotificationPreferencesInput, actor: Actor) {
    const { channelFrequency, ...columns } = input;
    await this.prisma.$transaction(async (tx) => {
      const channelFrequencyJson: Prisma.InputJsonObject | undefined =
        channelFrequency === undefined ? undefined : (channelFrequency as Prisma.InputJsonObject);
      await tx.notificationPreference.upsert({
        where: { patientProfileId: profileId },
        create: { patientProfileId: profileId, ...columns, ...(channelFrequencyJson === undefined ? {} : { channelFrequencyJson }) },
        update: { ...columns, ...(channelFrequencyJson === undefined ? {} : { channelFrequencyJson }) },
      });
      await writeAudit(tx, {
        action: "notification.preferences_updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole as AuditActorType,
        entityType: "notification_preference",
        entityId: profileId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: {
          pushEnabled: input.pushEnabled,
          privacyMode: input.privacyMode,
          quietHoursEnabled: input.quietHoursEnabled,
          soundEnabled: input.soundEnabled,
          vibrationEnabled: input.vibrationEnabled,
          // Kinds and frequencies only — no PHI in a preference anyway, but keep it coarse.
          ...(channelFrequency
            ? { channelFrequency: Object.fromEntries(Object.entries(channelFrequency).map(([k, v]) => [k, v.frequency])) }
            : {}),
        },
      });
    });
    return this.getPreferences(profileId);
  }

  // ───────────────────────── Measurement reminders (P17) ─────────────────────────

  async getMeasurementReminders(profileId: string): Promise<MeasurementRemindersInput> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { patientProfileId: profileId },
      select: { measurementRemindersJson: true, channelFrequencyJson: true },
    });
    if (!pref) return { concepts: {} };
    // The plan has its own column; rows written before that column existed
    // kept it under a reserved key in channelFrequencyJson.
    const fromColumn = readMeasurementReminders(pref.measurementRemindersJson);
    if (Object.keys(fromColumn.concepts).length > 0) return fromColumn;
    return readMeasurementReminders(pref.channelFrequencyJson);
  }

  /**
   * Full replace of the reminder plan (`GET/PUT profiles/current/measurement-reminders`),
   * in its own column so a saved plan can never collide with a
   * NotificationKind. The `detect-measurement-reminders` cron reads it, and
   * still falls back to the pre-column reserved key.
   */
  async updateMeasurementReminders(profileId: string, input: MeasurementRemindersInput, actor: Actor): Promise<MeasurementRemindersInput> {
    await this.prisma.$transaction(async (tx) => {
      const measurementRemindersJson: Prisma.InputJsonValue | typeof Prisma.DbNull =
        Object.keys(input.concepts).length > 0 ? (input as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
      await tx.notificationPreference.upsert({
        where: { patientProfileId: profileId },
        create: { patientProfileId: profileId, measurementRemindersJson },
        update: { measurementRemindersJson },
      });
      await writeAudit(tx, {
        action: "notification.measurement_reminders_updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole as AuditActorType,
        entityType: "notification_preference",
        entityId: profileId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        // Concept keys and slot counts only.
        context: { concepts: Object.fromEntries(Object.entries(input.concepts).map(([k, v]) => [k, v.times.length * v.days.length])) },
      });
    });
    return this.getMeasurementReminders(profileId);
  }

  /**
   * Queues a patient-facing `system` notification (docs_v2/10 H-49: the
   * patient is told when an administrator opens their record). Generic by
   * construction — the dispatcher's copy never says why. Keyed on the
   * grant so a retried request cannot notify twice. Runs in the caller's
   * transaction so a failed grant leaves no orphan ping.
   */
  async queueSystemNotification(tx: Prisma.TransactionClient, profileId: string, dedupeKey: string): Promise<{ id: string; created: boolean }> {
    const existing = await tx.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
    if (existing) return { id: existing.id, created: false };
    const created = await tx.notification.create({
      data: { patientProfileId: profileId, kind: "system", privacyMode: "generic", dedupeKey, status: "pending" },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  /**
   * Active refill/completion reminders (docs/07 screen 27) — a Home-screen
   * list, not just a transient push, so the patient can act whenever they
   * open the app. "Active" means still pending or already pushed but not
   * yet resolved (marked refilled, dismissed, or the medication left
   * "current") — never includes cancelled ones.
   */
  async listRefillReminders(profileId: string) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        patientProfileId: profileId,
        kind: { in: ["refill", "completion"] },
        status: { in: ["pending", "done"] },
        // Defense in depth against stranded rows (the pilot had reminders
        // created before stop/delete started cancelling both kinds): a
        // reminder for a medicine that is no longer "current" — or was
        // deleted — must never render, whatever its notification status.
        patientMedication: { is: { status: "current", deletedAt: null } },
      },
      include: {
        patientMedication: {
          include: {
            practitioner: true,
            instructions: { where: { supersededAt: null }, take: 1 },
            schedule: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      items: notifications
        .filter((n) => n.patientMedication)
        .map((n) => {
          const medication = n.patientMedication!;
          const instruction = medication.instructions[0];
          let daysRemainingEstimate: number | null = null;
          let estimatedDate: string | null = null;

          if (n.kind === "refill" && medication.quantityOnHand != null && instruction && medication.schedule) {
            const slots = medication.schedule.slots as unknown as SlotDose[];
            const dailyConsumption = Number(instruction.doseQuantity) * dailySlotQuantity(slots);
            if (dailyConsumption > 0) {
              daysRemainingEstimate = Math.max(0, Math.floor(Number(medication.quantityOnHand) / dailyConsumption));
              const date = new Date(Date.now() + daysRemainingEstimate * 24 * 60 * 60 * 1000);
              estimatedDate = date.toISOString().slice(0, 10);
            }
          } else if (n.kind === "completion" && medication.startDate && instruction?.durationDays) {
            const date = new Date(medication.startDate);
            date.setUTCDate(date.getUTCDate() + instruction.durationDays);
            estimatedDate = date.toISOString().slice(0, 10);
          }

          return {
            notificationId: n.id,
            kind: n.kind as "refill" | "completion",
            patientMedicationId: medication.id,
            medicationName: medication.enteredName,
            prescriberName: medication.practitioner?.displayName ?? null,
            quantityOnHand: medication.quantityOnHand != null ? String(medication.quantityOnHand) : null,
            rowVersion: medication.rowVersion,
            daysRemainingEstimate,
            estimatedDate,
          };
        }),
    };
  }

  /** Dismisses a refill/completion reminder without acting on it (docs/07 screen 27 secondary action). */
  async dismissRefillReminder(profileId: string, notificationId: string, actor: Actor) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, patientProfileId: profileId, kind: { in: ["refill", "completion"] } },
    });
    if (!notification) throw new ApiProblem(ERROR_CODES.NOT_FOUND, "Reminder not found", 404);

    await this.prisma.$transaction(async (tx) => {
      await tx.notification.update({ where: { id: notificationId }, data: { status: "cancelled" } });
      await writeAudit(tx, {
        action: "notification.dismissed",
        actorUserId: actor.userId,
        actorType: actor.actorRole as AuditActorType,
        entityType: "notification",
        entityId: notificationId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { kind: notification.kind },
      });
    });
    return { dismissed: true as const };
  }

  /**
   * Caregiver-visible missed-dose alert history — a recent-attention view,
   * not a full history. Deliberately reads the dose's own live status
   * rather than the Notification row: a missed dose with nobody to
   * escalate to (no caregiver channel active) still gets its Notification
   * cancelled with nothing sent (detect-due-reminders.ts), which would
   * otherwise make this list just as blind as the push it's meant to back
   * up. Both branches are bounded to the trailing window and the combined
   * list silently capped — the push/SMS `caregiver_escalation` at miss
   * time is the primary channel, Timeline keeps the full per-day record,
   * and the retention-cleanup cron is the long-term bound, so an
   * ever-growing on-Home list of stale misses has no ongoing value
   * (hazard H-26 covers the trade-off).
   */
  async listCaregiverAlerts(profileId: string) {
    const windowStart = new Date(Date.now() - CAREGIVER_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const doses = await this.prisma.scheduledDose.findMany({
      where: {
        medicationSchedule: { patientMedication: { patientProfileId: profileId, deletedAt: null } },
        OR: [
          { status: "missed", dueAt: { gte: windowStart } },
          { status: "taken_other_time", updatedAt: { gte: windowStart } },
        ],
      },
      include: { medicationSchedule: { include: { patientMedication: true } } },
      orderBy: { dueAt: "desc" },
      take: CAREGIVER_ALERT_MAX_ITEMS,
    });

    return {
      items: doses.map((d) => ({
        scheduledDoseId: d.id,
        medicationName: d.medicationSchedule.patientMedication.enteredName,
        dueAt: d.dueAt.toISOString(),
        quantity: String(d.quantity),
        status: d.status as "missed" | "taken_other_time",
        updatedAt: d.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Applies a Telnyx delivery-status webhook to the attempt it belongs to
   * (docs/16 follow-up — signature already verified by the caller). No
   * matching attempt is expected and fine to ignore silently: OTP sends
   * never create a `NotificationAttempt` row, so their webhooks have
   * nothing to correlate against.
   *
   * A confirmed permanent-destination failure (see
   * `PERMANENT_DESTINATION_FAILURE_CODES` in `@medpass/notifications`) also
   * revokes the SMS channel it was sent through, the same way a web-push
   * subscription is revoked on a 404/410 — this is the one signal narrow
   * and unambiguous enough to act on automatically (docs/22's prior "not
   * done" note: most Telnyx failure codes are account/config-level, not
   * proof a specific number is dead, so acting on them generally would
   * risk silently stopping reminders for someone still reachable).
   */
  async recordTelnyxDeliveryOutcome(
    messageId: string,
    outcome: "delivered" | "failed",
    errorDigest?: string,
    permanentDestinationFailure?: boolean,
  ): Promise<void> {
    const attempt = await this.prisma.notificationAttempt.findFirst({ where: { providerMessageId: messageId } });
    if (!attempt) return;

    await this.prisma.$transaction(async (tx) => {
      await tx.notificationAttempt.update({
        where: { id: attempt.id },
        data: { status: outcome, statusAt: new Date(), ...(errorDigest ? { errorDigest } : {}) },
      });

      if (!permanentDestinationFailure || attempt.channel !== "sms" || !attempt.notificationChannelId) return;

      // Guarded update so a retried/duplicate webhook delivery can't write a
      // second audit event for a channel that's already revoked.
      const revoked = await tx.notificationChannel.updateMany({
        where: { id: attempt.notificationChannelId, status: { not: "revoked" } },
        data: { status: "revoked" },
      });
      if (revoked.count === 0) return;

      const channel = await tx.notificationChannel.findUniqueOrThrow({ where: { id: attempt.notificationChannelId } });
      await writeAudit(tx, {
        action: "notification.channel_revoked",
        actorType: "system",
        actorUserId: channel.userId,
        entityType: "notification_channel",
        entityId: channel.id,
        context: { channel: "sms", reason: errorDigest ?? "permanent_destination_failure" },
      });
    });
  }
}
