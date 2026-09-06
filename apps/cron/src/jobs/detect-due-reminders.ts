/**
 * Detects scheduled doses due within a small sliding window and dispatches a
 * reminder over every channel the recipient has active — web push, and
 * SMS via Telnyx (docs/16, OD-10 resolved; WhatsApp remains blocked — no
 * WhatsApp Business Account connected to this account). Idempotent via
 * `dedupeKey` on Notification, so a restart or an overlapping run can never
 * double-send for the same dose.
 *
 * Detection and dispatch are separate passes: a Notification is created
 * (status `pending`) the moment a dose becomes due, but only actually sent
 * once — and possibly several ticks later, if quiet hours are in effect
 * (docs/16 §quiet hours). Every tick retries every still-`pending`
 * notification regardless of how long ago its dose became due, so a long
 * quiet-hours window can't cause a reminder to be silently dropped once
 * quiet hours end.
 *
 * Pass 2 lives in ../lib/dispatch-notifications.ts (so it can be tested
 * against a real database with a fake sender) and handles every kind:
 * dose reminders from here, refill/completion/refill_low from
 * generate-refill-reminders.ts, caregiver_escalation from
 * reconcile-missed-doses.ts, dose_correction and the V2 caregiver kinds
 * (new_prescription / new_test_result) from the API. The per-kind
 * channel/frequency control (docs_v2/04 §12, H-48) is applied there.
 *
 * A successful SMS send's `NotificationAttempt` records Telnyx's message id
 * (`providerMessageId`) — this job only ever sees the synchronous
 * queue-acceptance result, not the real final delivery outcome, which
 * arrives later via the API's Telnyx webhook receiver
 * (`TelnyxWebhookController`) and correlates back to this same row.
 */
import { LogEmailSender, TelnyxSmsSender, VapidWebPushSender } from "@medpass/notifications";
import { dispatchPendingNotifications, resolveRecipients } from "../lib/dispatch-notifications";
import { runJob } from "../lib/run-job";

const WINDOW_MINUTES = 2;

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
  // P17 email channel: EMAIL_TRANSPORT only admits "log" today — a no-op
  // sender that records the attempt and logs a PHI-free line. It never
  // counts as "a channel configured" above: with no push and no SMS there
  // is still nothing real to deliver.
  const emailSender = config.EMAIL_TRANSPORT === "log" ? new LogEmailSender((obj, msg) => log.info(obj, msg)) : undefined;

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

  // --- Pass 2: dispatch every still-pending notification of every kind. ---
  const dispatched = await dispatchPendingNotifications(prisma, { pushSender, smsSender, emailSender, config, log, now });

  log.info({ created, ...dispatched }, "detect-due-reminders completed");
  return { created, ...dispatched };
});
