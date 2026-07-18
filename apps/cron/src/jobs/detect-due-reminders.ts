/**
 * Detects scheduled doses due within a small sliding window and sends a web
 * push reminder (docs/16 — reminders are core to the product; never depend
 * only on browser notifications, but this is the one channel unblocked
 * this pass: SMS/WhatsApp need a provider decision, OD-10). Idempotent via
 * `dedupeKey` on Notification, so a restart or an overlapping run can never
 * double-send for the same dose.
 *
 * Detection and dispatch are separate passes: a Notification is created
 * (status `pending`) the moment a dose becomes due, but only actually sent
 * once — and possibly several ticks later, if quiet hours are in effect
 * (docs/16 §quiet hours). Every tick retries every still-`pending`
 * notification regardless of how long ago its dose became due, so a long
 * quiet-hours window can't cause a reminder to be silently dropped once
 * quiet hours end. Recipients are the profile owner plus any caregiver
 * holding `manage_reminders` (or `full_management`) — consented reminder
 * fan-out, not the separate missed-dose escalation flow (not built).
 *
 * Decrypting the stored push subscription duplicates the small AES-256-GCM
 * routine in apps/api/src/common/crypto.ts rather than sharing it — same
 * reasoning as extend-scheduled-doses.ts: the cron app has no NestJS
 * dependency, and this is a handful of lines (docs/02: no premature
 * abstraction). Any drift would fail loudly (decryption produces garbage),
 * not silently.
 */
import { createDecipheriv, createHash } from "node:crypto";
import { VapidWebPushSender, type WebPushSubscriptionDetails } from "@medpass/notifications";
import type { PrismaClient } from "@medpass/database";
import { runJob } from "../lib/run-job";

const WINDOW_MINUTES = 2;
const SCHEDULE_TIMEZONE_OFFSET_MINUTES = 5.5 * 60; // Asia/Kolkata, fixed (matches extend-scheduled-doses.ts)

function decryptAddress(ciphertext: string, fieldEncryptionKey: string): WebPushSubscriptionDetails {
  const key = createHash("sha256").update(fieldEncryptionKey).digest();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as WebPushSubscriptionDetails;
}

/** Minutes since local midnight, in the fixed IST offset. */
function localMinutesNow(): number {
  const istNow = new Date(Date.now() + SCHEDULE_TIMEZONE_OFFSET_MINUTES * 60_000);
  return istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Handles a window that wraps midnight (e.g. 22:00 → 07:00). */
function isWithinQuietHours(pref: { quietHoursEnabled: boolean; quietHoursStart: string; quietHoursEnd: string }): boolean {
  if (!pref.quietHoursEnabled) return false;
  const nowMin = localMinutesNow();
  const start = toMinutes(pref.quietHoursStart);
  const end = toMinutes(pref.quietHoursEnd);
  if (start === end) return false;
  return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
}

interface Recipient {
  channelId: string;
  addressCiphertext: string;
}

/** Owner + any caregiver with reminder-management scope (docs/16 consented escalation). */
async function resolveRecipients(prisma: PrismaClient, profileId: string, ownerUserId: string): Promise<Recipient[]> {
  const caregivers = await prisma.caregiverRelationship.findMany({
    where: {
      patientProfileId: profileId,
      status: "active",
      caregiverUserId: { not: null },
      permissions: { some: { scope: { in: ["manage_reminders", "full_management"] }, revokedAt: null } },
    },
    select: { caregiverUserId: true },
  });
  const userIds = [ownerUserId, ...caregivers.map((c) => c.caregiverUserId!)];
  const channels = await prisma.notificationChannel.findMany({
    where: { userId: { in: userIds }, channel: "web_push", status: "active" },
  });
  return channels.map((c) => ({ channelId: c.id, addressCiphertext: c.addressCiphertext }));
}

runJob("detect-due-reminders", async ({ prisma, log, config }) => {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    log.info({}, "push not configured (VAPID keys unset) — skipping");
    return { sent: 0 };
  }
  const sender = new VapidWebPushSender({
    publicKey: config.VAPID_PUBLIC_KEY,
    privateKey: config.VAPID_PRIVATE_KEY,
    subject: config.VAPID_SUBJECT,
  });

  // --- Pass 1: detect newly-due doses, create a pending Notification. ---
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60_000);
  const dueDoses = await prisma.scheduledDose.findMany({
    where: { status: "upcoming", dueAt: { gte: windowStart, lte: now } },
    include: {
      medicationSchedule: {
        include: { patientMedication: { include: { patientProfile: { include: { notificationPreference: true } } } } },
      },
    },
  });

  let created = 0;
  for (const dose of dueDoses) {
    const profile = dose.medicationSchedule.patientMedication.patientProfile;
    if (!profile.notificationPreference?.pushEnabled) continue;

    const dedupeKey = `${dose.id}:web_push`;
    const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) continue;

    const recipients = await resolveRecipients(prisma, profile.id, profile.ownerUserId);
    if (recipients.length === 0) continue; // nothing to notify yet — re-detected next tick while still in window

    await prisma.notification.create({
      data: {
        patientProfileId: profile.id,
        kind: "dose_reminder",
        scheduledDoseId: dose.id,
        privacyMode: profile.notificationPreference.privacyMode,
        dedupeKey,
        status: "pending",
      },
    });
    created++;
  }

  // --- Pass 2: attempt dispatch for every still-pending notification, new
  // or deferred from quiet hours on a previous tick. ---
  const pending = await prisma.notification.findMany({
    where: { status: "pending", kind: "dose_reminder" },
    include: {
      patientProfile: { include: { notificationPreference: true } },
      scheduledDose: { include: { medicationSchedule: { include: { patientMedication: true } } } },
    },
  });

  let sent = 0;
  let deferred = 0;
  for (const notification of pending) {
    const pref = notification.patientProfile.notificationPreference;
    if (pref && isWithinQuietHours(pref)) {
      deferred++;
      continue;
    }

    const recipients = await resolveRecipients(prisma, notification.patientProfileId, notification.patientProfile.ownerUserId);
    if (recipients.length === 0) {
      await prisma.notification.update({ where: { id: notification.id }, data: { status: "cancelled" } });
      continue;
    }

    const medicationName = notification.scheduledDose?.medicationSchedule.patientMedication.enteredName;
    const payload =
      notification.privacyMode === "full_name" && medicationName
        ? { title: medicationName, body: "It's time to take this now.", url: "/timeline" }
        : { title: "Medicine reminder", body: "Time to take your scheduled medicine.", url: "/timeline" };

    let anySent = false;
    for (const recipient of recipients) {
      try {
        const subscription = decryptAddress(recipient.addressCiphertext, config.FIELD_ENCRYPTION_KEY);
        const result = await sender.send(subscription, payload);
        if (result.ok) {
          anySent = true;
          await prisma.notificationAttempt.create({
            data: { notificationId: notification.id, notificationChannelId: recipient.channelId, channel: "web_push", status: "sent" },
          });
        } else {
          await prisma.notificationAttempt.create({
            data: {
              notificationId: notification.id,
              notificationChannelId: recipient.channelId,
              channel: "web_push",
              status: "failed",
              errorDigest: `http_${result.statusCode ?? "unknown"}`,
            },
          });
          if (result.gone) {
            await prisma.notificationChannel.update({ where: { id: recipient.channelId }, data: { status: "revoked" } });
          }
        }
      } catch (err) {
        log.error({ channelId: recipient.channelId, err: err instanceof Error ? err.message : "unknown" }, "push send failed");
        await prisma.notificationAttempt.create({
          data: {
            notificationId: notification.id,
            notificationChannelId: recipient.channelId,
            channel: "web_push",
            status: "failed",
            errorDigest: "send_error",
          },
        });
      }
    }
    await prisma.notification.update({ where: { id: notification.id }, data: { status: anySent ? "done" : "cancelled" } });
    if (anySent) sent++;
  }

  log.info({ created, sent, deferred }, "detect-due-reminders completed");
  return { created, sent, deferred };
});
