import { Injectable } from "@nestjs/common";
import { writeAudit } from "@medpass/audit";
import type { AuditActorType } from "@medpass/domain";
import type { NotificationPreferencesInput, WebPushSubscribeInput } from "@medpass/validation";
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
    };
  }

  async updatePreferences(profileId: string, input: NotificationPreferencesInput, actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.notificationPreference.upsert({
        where: { patientProfileId: profileId },
        create: { patientProfileId: profileId, pushEnabled: input.pushEnabled, privacyMode: input.privacyMode },
        update: { pushEnabled: input.pushEnabled, privacyMode: input.privacyMode },
      });
      await writeAudit(tx, {
        action: "notification.preferences_updated",
        actorUserId: actor.userId,
        actorType: actor.actorRole as AuditActorType,
        entityType: "notification_preference",
        entityId: profileId,
        patientProfileId: profileId,
        correlationId: actor.correlationId,
        context: { pushEnabled: input.pushEnabled, privacyMode: input.privacyMode },
      });
    });
    return input;
  }
}
