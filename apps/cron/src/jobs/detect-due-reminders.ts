/**
 * Detects scheduled doses due within a small sliding window and dispatches a
 * reminder over every channel the recipient has active — web push, and now
 * SMS via Telnyx (docs/16, OD-10 resolved this pass; WhatsApp remains
 * blocked — no WhatsApp Business Account connected to this account).
 * Idempotent via `dedupeKey` on Notification, so a restart or an
 * overlapping run can never double-send for the same dose.
 *
 * Detection and dispatch are separate passes: a Notification is created
 * (status `pending`) the moment a dose becomes due, but only actually sent
 * once — and possibly several ticks later, if quiet hours are in effect
 * (docs/16 §quiet hours). Every tick retries every still-`pending`
 * notification regardless of how long ago its dose became due, so a long
 * quiet-hours window can't cause a reminder to be silently dropped once
 * quiet hours end. Recipients are the profile owner plus any caregiver
 * holding `manage_reminders` (or `full_management`) — consented reminder
 * fan-out.
 *
 * `caregiver_escalation` notifications (created by
 * reconcile-missed-doses.ts, once a dose is confirmed missed) are dispatched
 * by this same Pass 2, but recipients are caregivers only — escalating to
 * yourself makes no sense — and quiet hours are bypassed entirely when the
 * medicine involved has its patient-set `criticalEscalation` flag on
 * (docs/16 "opt-in policy": never an inferred clinical judgement of
 * severity, only ever a choice the patient made for that specific medicine).
 *
 * `dose_correction` notifications (created by TimelineService.recordDoseEvent
 * when a patient marks a previously-missed dose "taken at another time" and
 * an escalation for it had already gone out) go to the same escalation-only
 * recipient set — a false-alarm follow-up, not a new emergency, so unlike
 * `caregiver_escalation` it never bypasses quiet hours.
 *
 * SMS is gated purely by an active `sms` NotificationChannel existing at
 * all — which only ever exists because the consents cascade
 * (ConsentsController) created it when the patient granted `sms_reminders`
 * consent, so "channel active" already means "consented" (docs/16: SMS
 * needs explicit consent). Web push additionally requires the patient's
 * own `pushEnabled` preference toggle, since that's a UX on/off switch
 * independent of whether a channel happens to still be registered.
 *
 * A successful SMS send's `NotificationAttempt` records Telnyx's message id
 * (`providerMessageId`) — this job only ever sees the synchronous
 * queue-acceptance result, not the real final delivery outcome, which
 * arrives later via the API's Telnyx webhook receiver
 * (`TelnyxWebhookController`) and correlates back to this same row.
 *
 * Decrypting stored channel addresses duplicates the small AES-256-GCM
 * routine in apps/api/src/common/crypto.ts rather than sharing it — same
 * reasoning as extend-scheduled-doses.ts: the cron app has no NestJS
 * dependency, and this is a handful of lines (docs/02: no premature
 * abstraction). Any drift would fail loudly (decryption produces garbage),
 * not silently.
 *
 * Cost control (docs/31 "reminder limits: per-profile channel caps... never
 * throttle patient-critical reminders"): a daily per-profile cap on SMS
 * sends applies only to `refill`/`completion` — informational, already
 * backed by their own standing in-app list, so skipping today's SMS
 * attempt loses nothing safety-critical. `dose_reminder` and
 * `caregiver_escalation` never check the cap — those are exactly the
 * reminders that must never be silently throttled. The cap reuses the same
 * `RateLimitBucket` table the API's `RateLimitService` uses (docs/22 Stage
 * 11 follow-up), duplicated here as a plain query for the same
 * no-NestJS-in-cron reason as the decryption helpers above.
 */
import { createDecipheriv, createHash } from "node:crypto";
import { minutesSinceMidnightInTz } from "@medpass/domain";
import { TelnyxSmsSender, VapidWebPushSender, type WebPushPayload, type WebPushSubscriptionDetails } from "@medpass/notifications";
import type { NotificationChannelKind, PrismaClient } from "@medpass/database";
import { runJob } from "../lib/run-job";

const WINDOW_MINUTES = 2;
/** Generous: well above docs/31's ~3 reminders/day/patient baseline, bounding a genuine runaway rather than normal heavy use. */
const SMS_REMINDER_DAILY_CAP = 15;
const NON_CRITICAL_KINDS = new Set(["refill", "completion"]);
/**
 * Patient-facing kinds get a louder push (vibration, persistent,
 * high-urgency delivery) — never caregiver_escalation/dose_correction, which
 * are caregiver-only and already have their own separate quiet-hours-bypass
 * logic (docs/16). `missed_dose`/`safety_finding` are defined on the enum
 * but nothing creates them yet — included here for definitional
 * completeness, inert until something does.
 */
const LOUD_KINDS = new Set(["dose_reminder", "refill", "completion", "missed_dose", "safety_finding"]);

/** Same fixed-window upsert-increment as RateLimitService (apps/api) — see file header for why this is duplicated here. */
async function checkAndIncrementDailyCap(prisma: PrismaClient, key: string, limit: number): Promise<boolean> {
  const windowMs = 24 * 60 * 60 * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const bucket = await prisma.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });
  return bucket.count <= limit;
}

function decryptPlaintext(ciphertext: string, fieldEncryptionKey: string): string {
  const key = createHash("sha256").update(fieldEncryptionKey).digest();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function decryptWebPushSubscription(ciphertext: string, fieldEncryptionKey: string): WebPushSubscriptionDetails {
  return JSON.parse(decryptPlaintext(ciphertext, fieldEncryptionKey)) as WebPushSubscriptionDetails;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/**
 * Handles a window that wraps midnight (e.g. 22:00 → 07:00). "Night" is the
 * patient's night: quiet hours are wall-clock times in the profile's own
 * timezone (docs/16), so 22:00 means 22:00 wherever the patient lives.
 */
function isWithinQuietHours(
  pref: { quietHoursEnabled: boolean; quietHoursStart: string; quietHoursEnd: string },
  timezone: string,
): boolean {
  if (!pref.quietHoursEnabled) return false;
  const nowMin = minutesSinceMidnightInTz(timezone);
  const start = toMinutes(pref.quietHoursStart);
  const end = toMinutes(pref.quietHoursEnd);
  if (start === end) return false;
  return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
}

interface Recipient {
  channelId: string;
  channel: NotificationChannelKind;
  addressCiphertext: string;
}

interface PendingNotification {
  kind: string;
  privacyMode: string;
  patientProfileId: string;
  patientMedicationId: string | null;
  dedupeKey: string;
  scheduledDose: { medicationSchedule: { patientMedication: { enteredName: string } } } | null;
}

/**
 * Builds the push payload for whichever kind of pending notification this is
 * (docs/16 privacy rule: the medicine name is never shown unless the
 * profile opted into `full_name`). `refill`/`completion` link to the
 * medicine itself rather than the timeline, since that's where the patient
 * acts (docs/07 screen 27). Patient-facing kinds (`LOUD_KINDS`) additionally
 * carry vibration/persistence/sound hints, gated by the profile's own
 * preference — caregiver_escalation/dose_correction are untouched, exactly
 * today's plain payload.
 */
function buildPushPayload(
  notification: PendingNotification,
  medicationName: string | undefined,
  pref: { soundEnabled: boolean; vibrationEnabled: boolean } | null,
): WebPushPayload {
  const fullName = notification.privacyMode === "full_name" && medicationName;
  const base: WebPushPayload = (() => {
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
      case "caregiver_escalation":
        return fullName
          ? { title: medicationName!, body: "A scheduled dose may have been missed. Please check in.", url: "/timeline" }
          : { title: "Missed dose", body: "A scheduled dose may have been missed. Please check in.", url: "/timeline" };
      case "dose_correction":
        return fullName
          ? { title: medicationName!, body: "Actually taken — the earlier missed-dose alert was a false alarm.", url: "/timeline" }
          : { title: "Missed-dose update", body: "A medicine reported as missed was actually taken. No action needed.", url: "/timeline" };
      default:
        throw new Error(`unexpected notification kind: ${notification.kind}`);
    }
  })();

  if (!LOUD_KINDS.has(notification.kind)) return base;

  const soundEnabled = pref?.soundEnabled ?? true;
  const vibrationEnabled = pref?.vibrationEnabled ?? true;
  return {
    ...base,
    profileId: notification.patientProfileId,
    tag: notification.dedupeKey,
    renotify: true,
    requireInteraction: true,
    silent: !soundEnabled,
    ...(vibrationEnabled ? { vibrate: [300, 100, 300, 100, 300] } : {}),
  };
}

/** Owner + any caregiver with reminder-management scope (docs/16 consented escalation). */
async function resolveRecipients(
  prisma: PrismaClient,
  profileId: string,
  ownerUserId: string,
  pref: { pushEnabled: boolean } | null,
): Promise<Recipient[]> {
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

  // web_push is gated by the patient's own on/off preference; sms's only
  // gate is the channel existing at all, since it only exists because
  // consent was granted (see file header).
  const wantedChannels: NotificationChannelKind[] = ["sms"];
  if (pref?.pushEnabled) wantedChannels.push("web_push");

  const channels = await prisma.notificationChannel.findMany({
    where: { userId: { in: userIds }, channel: { in: wantedChannels }, status: "active" },
  });
  return channels.map((c) => ({ channelId: c.id, channel: c.channel, addressCiphertext: c.addressCiphertext }));
}

/**
 * Caregivers only (never the owner — escalating to yourself makes no
 * sense), reusing the exact same reminder-management scope as
 * `resolveRecipients`. Both channels are wanted unconditionally: this
 * doesn't gate on the patient's own `pushEnabled` preference, since that's
 * the patient's toggle for reminders about themselves, not a say over
 * whether their caregiver gets told about a missed dose.
 */
async function resolveEscalationRecipients(prisma: PrismaClient, profileId: string): Promise<Recipient[]> {
  const caregivers = await prisma.caregiverRelationship.findMany({
    where: {
      patientProfileId: profileId,
      status: "active",
      caregiverUserId: { not: null },
      permissions: { some: { scope: { in: ["manage_reminders", "full_management"] }, revokedAt: null } },
    },
    select: { caregiverUserId: true },
  });
  if (caregivers.length === 0) return [];

  const channels = await prisma.notificationChannel.findMany({
    where: { userId: { in: caregivers.map((c) => c.caregiverUserId!) }, channel: { in: ["sms", "web_push"] }, status: "active" },
  });
  return channels.map((c) => ({ channelId: c.id, channel: c.channel, addressCiphertext: c.addressCiphertext }));
}

runJob("detect-due-reminders", async ({ prisma, log, config }) => {
  const pushSender =
    config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
      ? new VapidWebPushSender({ publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, subject: config.VAPID_SUBJECT })
      : undefined;
  const smsSender =
    config.TELNYX_API_KEY && config.TELNYX_FROM_NUMBER
      ? new TelnyxSmsSender({ apiKey: config.TELNYX_API_KEY, fromNumber: config.TELNYX_FROM_NUMBER, webhookUrl: config.TELNYX_WEBHOOK_URL })
      : undefined;
  if (!pushSender && !smsSender) {
    log.info({}, "no reminder channel configured (no VAPID keys, no Telnyx key) — skipping");
    return { sent: 0 };
  }

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
    const dedupeKey = `${dose.id}:reminder`;
    const existing = await prisma.notification.findUnique({ where: { dedupeKey } });
    if (existing) continue;

    const recipients = await resolveRecipients(prisma, profile.id, profile.ownerUserId, profile.notificationPreference);
    if (recipients.length === 0) continue; // nothing to notify yet — re-detected next tick while still in window

    await prisma.notification.create({
      data: {
        patientProfileId: profile.id,
        kind: "dose_reminder",
        scheduledDoseId: dose.id,
        privacyMode: profile.notificationPreference?.privacyMode ?? "generic",
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
    where: { status: "pending", kind: { in: ["dose_reminder", "refill", "completion", "caregiver_escalation", "dose_correction"] } },
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
    const bypassQuietHours = notification.kind === "caregiver_escalation" && notification.patientMedication?.criticalEscalation === true;
    if (pref && isWithinQuietHours(pref, notification.patientProfile.timezone) && !bypassQuietHours) {
      deferred++;
      continue;
    }

    const recipients =
      notification.kind === "caregiver_escalation" || notification.kind === "dose_correction"
        ? await resolveEscalationRecipients(prisma, notification.patientProfileId)
        : await resolveRecipients(prisma, notification.patientProfileId, notification.patientProfile.ownerUserId, pref);
    if (recipients.length === 0) {
      // dose_reminder has no value beyond the send itself (the Timeline
      // already shows the due dose), so nothing left to do — cancel it.
      // caregiver_escalation/dose_correction have no in-app surface of their
      // own either (unlike refill/completion's standing list), so an empty
      // caregiver set is equally final — cancel. refill/completion are a
      // standing in-app list (docs/07 screen 27): with no channel there's
      // nothing to send, but the reminder itself is still real and must stay
      // visible, so it's left `pending` rather than cancelled — a channel
      // added later still gets a send on the very next tick.
      if (notification.kind === "dose_reminder" || notification.kind === "caregiver_escalation" || notification.kind === "dose_correction") {
        await prisma.notification.update({ where: { id: notification.id }, data: { status: "cancelled" } });
      }
      continue;
    }

    const medicationName =
      notification.scheduledDose?.medicationSchedule.patientMedication.enteredName ?? notification.patientMedication?.enteredName;

    let anySent = false;
    for (const recipient of recipients) {
      try {
        if (recipient.channel === "web_push") {
          if (!pushSender) throw new Error("web_push channel exists but VAPID keys aren't configured");
          const subscription = decryptWebPushSubscription(recipient.addressCiphertext, config.FIELD_ENCRYPTION_KEY);
          const result = await pushSender.send(subscription, buildPushPayload(notification, medicationName, pref), {
            urgency: LOUD_KINDS.has(notification.kind) ? "high" : "normal",
          });
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
        } else if (recipient.channel === "sms") {
          if (!smsSender) throw new Error("sms channel exists but TELNYX_API_KEY/TELNYX_FROM_NUMBER aren't configured");
          if (NON_CRITICAL_KINDS.has(notification.kind)) {
            const withinCap = await checkAndIncrementDailyCap(
              prisma,
              `sms_reminder_daily:${notification.patientProfileId}`,
              SMS_REMINDER_DAILY_CAP,
            );
            if (!withinCap) {
              log.warn(
                { profileId: notification.patientProfileId, kind: notification.kind },
                "daily SMS reminder cap reached — skipping this non-critical send, reminder stays pending",
              );
              continue;
            }
          }
          const phoneE164 = decryptPlaintext(recipient.addressCiphertext, config.FIELD_ENCRYPTION_KEY);
          const { providerMessageId } = await smsSender.sendTemplate(phoneE164, notification.kind, {
            medicationName: notification.privacyMode === "full_name" ? (medicationName ?? "") : "",
          });
          anySent = true;
          await prisma.notificationAttempt.create({
            data: {
              notificationId: notification.id,
              notificationChannelId: recipient.channelId,
              channel: "sms",
              status: "sent",
              providerMessageId,
            },
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        log.error({ channelId: recipient.channelId, channel: recipient.channel, err: message }, "reminder send failed");
        await prisma.notificationAttempt.create({
          data: {
            notificationId: notification.id,
            notificationChannelId: recipient.channelId,
            channel: recipient.channel,
            status: "failed",
            errorDigest: message.slice(0, 200),
          },
        });
      }
    }
    // dose_reminder, caregiver_escalation and dose_correction have nothing
    // left to do after a failed send (none has a standing in-app surface) —
    // cancelled. refill/completion's in-app list (docs/07 screen 27) is the
    // real source of truth regardless of send outcome, so a failed send
    // leaves it pending rather than making a still-true condition (low
    // supply, course ended) vanish from view; only an explicit patient
    // action (mark refilled, dismiss, status change) ever cancels one of
    // these.
    const failureStatus =
      notification.kind === "dose_reminder" || notification.kind === "caregiver_escalation" || notification.kind === "dose_correction"
        ? "cancelled"
        : "pending";
    await prisma.notification.update({ where: { id: notification.id }, data: { status: anySent ? "done" : failureStatus } });
    if (anySent) sent++;
  }

  log.info({ created, sent, deferred }, "detect-due-reminders completed");
  return { created, sent, deferred };
});
