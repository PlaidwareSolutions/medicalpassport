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

interface PendingNotification {
  kind: string;
  privacyMode: string;
  patientMedicationId: string | null;
  scheduledDose: { medicationSchedule: { patientMedication: { enteredName: string } } } | null;
}

/**
 * Builds the push payload for whichever kind of pending notification this is
 * (docs/16 privacy rule: the medicine name is never shown unless the
 * profile opted into `full_name`). `refill`/`completion` link to the
 * medicine itself rather than the timeline, since that's where the patient
 * acts (docs/07 screen 27).
 */
function buildPayload(notification: PendingNotification, medicationName: string | undefined): { title: string; body: string; url: string } {
  const fullName = notification.privacyMode === "full_name" && medicationName;
  switch (notification.kind) {
    case "dose_reminder":
      return fullName
        ? { title: medicationName!, body: "It's time to take this now.", url: "/timeline" }
        : { title: "Medicine reminder", body: "Time to take your scheduled medicine.", url: "/timeline" };
    case "refill": {
      const url = `/medicines/${notification.patientMedicationId}`;
      return fullName
        ? { title: medicationName!, body: "You may be running low — check your supply.", url }
        : { title: "Medicine reminder", body: "You may be running low on a medicine. Check your supply.", url };
    }
    case "completion": {
      const url = `/medicines/${notification.patientMedicationId}`;
      return fullName
        ? { title: medicationName!, body: "This course was expected to finish. Please review it.", url }
        : { title: "Medicine reminder", body: "A course of medicine was expected to finish. Please review it.", url };
    }
    default:
      throw new Error(`unexpected notification kind: ${notification.kind}`);
  }
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
  // or deferred from quiet hours on a previous tick — any kind, including
  // refill/completion queued by generate-refill-reminders.ts, which never
  // dispatches anything itself. ---
  const pending = await prisma.notification.findMany({
    where: { status: "pending", kind: { in: ["dose_reminder", "refill", "completion"] } },
    include: {
      patientProfile: { include: { notificationPreference: true } },
      scheduledDose: { include: { medicationSchedule: { include: { patientMedication: true } } } },
      patientMedication: true,
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
      // dose_reminder has no value beyond the push itself (the Timeline
      // already shows the due dose), so nothing left to do — cancel it.
      // refill/completion are also a standing in-app list (docs/07 screen
      // 27): with no push channel there's nothing to send, but the
      // reminder itself is still real and must stay visible, so it's left
      // `pending` rather than cancelled — a channel added later still
      // gets a push on the very next tick.
      if (notification.kind === "dose_reminder") {
        await prisma.notification.update({ where: { id: notification.id }, data: { status: "cancelled" } });
      }
      continue;
    }

    const medicationName =
      notification.scheduledDose?.medicationSchedule.patientMedication.enteredName ?? notification.patientMedication?.enteredName;
    const payload = buildPayload(notification, medicationName);

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
    // dose_reminder has nothing left to do after a failed send (the Timeline
    // is the real source of truth) — cancelled. refill/completion's in-app
    // list (docs/07 screen 27) is the real source of truth regardless of
    // push outcome, so a failed send leaves it pending rather than making a
    // still-true condition (low supply, course ended) vanish from view;
    // only an explicit patient action (mark refilled, dismiss, status
    // change) ever cancels one of these.
    const failureStatus = notification.kind === "dose_reminder" ? "cancelled" : "pending";
    await prisma.notification.update({ where: { id: notification.id }, data: { status: anySent ? "done" : failureStatus } });
    if (anySent) sent++;
  }

  log.info({ created, sent, deferred }, "detect-due-reminders completed");
  return { created, sent, deferred };
});
