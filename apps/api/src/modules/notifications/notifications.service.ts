import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import { dailySlotQuantity, type SlotDose } from "@medpass/medication-terminology";
import { ERROR_CODES, type AuditActorType } from "@medpass/domain";
import type { NotificationPreferencesInput, WebPushSubscribeInput } from "@medpass/validation";
import { ApiProblem } from "../../common/errors";
import { encryptField, sha256Hex } from "../../common/crypto";
import { env } from "../../common/env";
import { PrismaService } from "../../common/prisma.service";

interface Actor {
  userId: string;
  actorRole: "patient" | "caregiver";
  correlationId?: string;
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
    };
  }

  async updatePreferences(profileId: string, input: NotificationPreferencesInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.notificationPreference.upsert({
        where: { patientProfileId: profileId },
        create: { patientProfileId: profileId, ...input },
        update: { ...input },
      });
      await writeAudit(tx, {
        action: "notification.preferences_updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole as AuditActorType,
        entityType: "notification_preference",
        entityId: profileId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { pushEnabled: input.pushEnabled, privacyMode: input.privacyMode, quietHoursEnabled: input.quietHoursEnabled },
      });
    });
    return input;
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
      where: { patientProfileId: profileId, kind: { in: ["refill", "completion"] }, status: { in: ["pending", "done"] } },
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
