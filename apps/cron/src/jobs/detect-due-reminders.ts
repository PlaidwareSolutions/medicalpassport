/**
 * Detects scheduled doses due within a small sliding window and sends a web
 * push reminder (docs/16 — reminders are core to the product; never depend
 * only on browser notifications, but this is the one channel unblocked
 * this pass: SMS/WhatsApp need a provider decision, OD-10). Idempotent via
 * `dedupeKey` on Notification, so a restart or an overlapping run can never
 * double-send for the same dose.
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
import { runJob } from "../lib/run-job";

const WINDOW_MINUTES = 2;

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

  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MINUTES * 60_000);
  const dueDoses = await prisma.scheduledDose.findMany({
    where: { status: "upcoming", dueAt: { gte: windowStart, lte: now } },
    include: {
      medicationSchedule: {
        include: {
          patientMedication: {
            include: { patientProfile: { include: { notificationPreference: true } } },
          },
        },
      },
    },
  });

  let sent = 0;
  let scanned = 0;
  for (const dose of dueDoses) {
    const medication = dose.medicationSchedule.patientMedication;
    const profile = medication.patientProfile;
    if (!profile.notificationPreference?.pushEnabled) continue;
    scanned++;

    const dedupeKey = `${dose.id}:web_push`;
    const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) continue;

    const channels = await prisma.notificationChannel.findMany({
      where: { userId: profile.ownerUserId, channel: "web_push", status: "active" },
    });
    if (channels.length === 0) continue;

    const privacyMode = profile.notificationPreference.privacyMode;
    const payload =
      privacyMode === "full_name"
        ? { title: medication.enteredName, body: "It's time to take this now.", url: "/timeline" }
        : { title: "Medicine reminder", body: "Time to take your scheduled medicine.", url: "/timeline" };

    const notification = await prisma.notification.create({
      data: {
        patientProfileId: profile.id,
        kind: "dose_reminder",
        scheduledDoseId: dose.id,
        privacyMode,
        dedupeKey,
        status: "dispatching",
      },
    });

    let anySent = false;
    for (const channel of channels) {
      try {
        const subscription = decryptAddress(channel.addressCiphertext, config.FIELD_ENCRYPTION_KEY);
        const result = await sender.send(subscription, payload);
        if (result.ok) {
          anySent = true;
          await prisma.notificationAttempt.create({
            data: { notificationId: notification.id, notificationChannelId: channel.id, channel: "web_push", status: "sent" },
          });
        } else {
          await prisma.notificationAttempt.create({
            data: {
              notificationId: notification.id,
              notificationChannelId: channel.id,
              channel: "web_push",
              status: "failed",
              errorDigest: `http_${result.statusCode ?? "unknown"}`,
            },
          });
          if (result.gone) {
            await prisma.notificationChannel.update({ where: { id: channel.id }, data: { status: "revoked" } });
          }
        }
      } catch (err) {
        log.error({ channelId: channel.id, err: err instanceof Error ? err.message : "unknown" }, "push send failed");
        await prisma.notificationAttempt.create({
          data: {
            notificationId: notification.id,
            notificationChannelId: channel.id,
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

  log.info({ scanned, sent }, "detect-due-reminders completed");
  return { scanned, sent };
});
