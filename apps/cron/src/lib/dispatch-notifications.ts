/**
 * Pass 2 of the reminder pipeline: attempt dispatch for every still-pending
 * Notification of every kind — dose reminders detected by
 * detect-due-reminders.ts, refill/completion/refill_low queued by
 * generate-refill-reminders.ts, caregiver_escalation from
 * reconcile-missed-doses.ts, dose_correction from the API, and the V2
 * caregiver kinds (new_prescription / new_test_result) queued by the API
 * inside the clinical write's own transaction.
 *
 * Extracted from detect-due-reminders.ts so the policy can be exercised
 * against a real database with a fake sender (see
 * caregiver-notifications.test.ts) — the job itself is a thin `runJob`
 * wrapper and cannot be imported without running.
 *
 * Rules, in the order they apply to each pending row:
 *  1. Per-kind control (docs_v2/04 §12, H-48): `off` cancels the row (or
 *     leaves a refill/completion pending — its in-app list is still true),
 *     `daily_digest` holds it for one morning send per kind, and `channels`
 *     narrows which channels may carry it. `dose_reminder` and
 *     `caregiver_escalation` ignore the control entirely.
 *  2. Quiet hours (docs/16), bypassed only by a critical escalation.
 *  3. Recipients: owner + reminder caregivers for patient kinds; caregivers
 *     only for escalation/correction; scope-matched caregivers minus the
 *     user who triggered it for the V2 caregiver kinds.
 *  4. Send over each remaining channel, record a NotificationAttempt per
 *     send, then settle the row.
 *
 * SMS cost cap (docs/31): only informational kinds count against the daily
 * per-profile cap — never dose_reminder or caregiver_escalation.
 *
 * Decrypting stored channel addresses duplicates the small AES-256-GCM
 * routine in apps/api/src/common/crypto.ts rather than sharing it — the
 * cron app has no NestJS dependency (docs/02: no premature abstraction).
 */
import { createFieldCrypto, keyringFromEnv, type FieldCrypto } from "@medpass/field-crypto";
import { minutesSinceMidnightInTz } from "@medpass/domain";
import type { EmailMessageSender, SmsMessageSender, WebPushPayload, WebPushSubscriptionDetails } from "@medpass/notifications";
import type { NotificationChannelKind, PrismaClient } from "@medpass/database";
import {
  CANCEL_WHEN_UNDELIVERABLE,
  caregiverScopesFor,
  channelAllowed,
  controlFor,
  dailyCapFor,
  digestDecision,
  isCaregiverKind,
  type KindControl,
} from "./notification-policy";
import { measurementConceptLabel, parseMeasurementReminderKey } from "./measurement-reminders";
import { parseTestDueKey } from "./test-due";

/** Generous: well above docs/31's ~3 reminders/day/patient baseline, bounding a genuine runaway rather than normal heavy use. */
const SMS_REMINDER_DAILY_CAP = 15;
/** Kinds whose SMS sends count against the daily cap — informational, each backed by an in-app surface. */
const CAPPED_SMS_KINDS = new Set(["refill", "completion", "new_prescription", "new_test_result", "refill_low"]);
/** Kinds that keep their pending row when nothing can be sent: their in-app list is the source of truth (docs/07 screen 27). */
const KEEP_PENDING_KINDS = new Set(["refill", "completion"]);
/**
 * Patient-facing kinds get a louder push (vibration, persistent,
 * high-urgency delivery) — never caregiver kinds, which are informational
 * and already have their own quiet-hours logic (docs/16). `missed_dose`/
 * `safety_finding` are defined on the enum but nothing creates them yet.
 */
const LOUD_KINDS = new Set(["dose_reminder", "refill", "completion", "missed_dose", "safety_finding"]);
export const DISPATCHED_KINDS = [
  "dose_reminder",
  "refill",
  "completion",
  "caregiver_escalation",
  "dose_correction",
  "new_prescription",
  "new_test_result",
  "refill_low",
  // V2 Phase 17: test-due (detect-test-due.ts), measurement reminders
  // (detect-measurement-reminders.ts) and the break-glass notice the API
  // queues as `system` (docs_v2/10 H-49).
  "test_due",
  "measurement_reminder",
  "system",
] as const;

export interface PushSender {
  send(subscription: WebPushSubscriptionDetails, payload: WebPushPayload, options?: { urgency?: "high" | "normal" }): Promise<{ ok: boolean; gone?: boolean; statusCode?: number }>;
}

export type KeyringEnv = { FIELD_ENCRYPTION_KEY: string; FIELD_ENCRYPTION_KEYS?: string; FIELD_ENCRYPTION_ACTIVE_KEY_VERSION?: number };

export interface DispatchDeps {
  pushSender?: PushSender;
  smsSender?: SmsMessageSender;
  /** P17 email channel; only the log transport exists (`EMAIL_TRANSPORT=log`). */
  emailSender?: EmailMessageSender;
  config: KeyringEnv;
  log: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void; error(obj: object, msg: string): void };
  /** Injectable clock, for the digest tests. */
  now?: Date;
}

export interface DispatchSummary {
  sent: number;
  deferred: number;
  cancelled: number;
  /** Rows folded into a daily digest send. */
  digested: number;
  /** Rows refused by the per-(profile, kind) daily cap (H-48 guardrail). */
  capped: number;
}

const cryptoByKey = new Map<string, FieldCrypto>();
function fieldCryptoFor(config: KeyringEnv): FieldCrypto {
  const key = `${config.FIELD_ENCRYPTION_KEY}|${config.FIELD_ENCRYPTION_KEYS ?? ""}|${config.FIELD_ENCRYPTION_ACTIVE_KEY_VERSION ?? ""}`;
  let instance = cryptoByKey.get(key);
  if (!instance) {
    instance = createFieldCrypto(keyringFromEnv(config));
    cryptoByKey.set(key, instance);
  }
  return instance;
}

function decryptPlaintext(ciphertext: string, config: KeyringEnv): string {
  return fieldCryptoFor(config).decrypt(ciphertext);
}

function decryptWebPushSubscription(ciphertext: string, config: KeyringEnv): WebPushSubscriptionDetails {
  return JSON.parse(decryptPlaintext(ciphertext, config)) as WebPushSubscriptionDetails;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Handles a window that wraps midnight (e.g. 22:00 → 07:00), in the patient's own zone (docs/16). */
export function isWithinQuietHours(
  pref: { quietHoursEnabled: boolean; quietHoursStart: string; quietHoursEnd: string },
  timezone: string,
  now: Date,
): boolean {
  if (!pref.quietHoursEnabled) return false;
  const nowMin = minutesSinceMidnightInTz(timezone, now);
  const start = toMinutes(pref.quietHoursStart);
  const end = toMinutes(pref.quietHoursEnd);
  if (start === end) return false;
  return start < end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
}

/** Same fixed-window upsert-increment as RateLimitService (apps/api) — duplicated for the no-NestJS-in-cron reason above. */
async function checkAndIncrementDailyCap(prisma: PrismaClient, key: string, limit: number, now: Date = new Date()): Promise<boolean> {
  const windowMs = 24 * 60 * 60 * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const bucket = await prisma.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });
  return bucket.count <= limit;
}

interface Recipient {
  channelId: string;
  channel: NotificationChannelKind;
  addressCiphertext: string;
}

interface PendingNotification {
  id: string;
  kind: string;
  privacyMode: string;
  patientProfileId: string;
  patientMedicationId: string | null;
  triggeredByUserId: string | null;
  dedupeKey: string;
  createdAt: Date;
  patientProfile: {
    ownerUserId: string;
    timezone: string;
    notificationPreference: {
      pushEnabled: boolean;
      soundEnabled: boolean;
      vibrationEnabled: boolean;
      quietHoursEnabled: boolean;
      quietHoursStart: string;
      quietHoursEnd: string;
      channelFrequencyJson: unknown;
    } | null;
  };
  scheduledDose: { medicationSchedule: { patientMedication: { enteredName: string } } } | null;
  patientMedication: { enteredName: string; criticalEscalation: boolean } | null;
}

/**
 * Builds the push payload for one pending notification (docs/16 privacy
 * rule: the medicine name is never shown unless the profile opted into
 * `full_name`). Patient-facing kinds (`LOUD_KINDS`) additionally carry
 * vibration/persistence/sound hints, gated by the profile's own preference.
 */
export function buildPushPayload(
  notification: Pick<PendingNotification, "kind" | "privacyMode" | "patientProfileId" | "patientMedicationId" | "dedupeKey">,
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
      // V2 caregiver kinds (docs_v2/06 P6-4). Generic by construction — the
      // profile's privacy mode governs only the medicine name in refill_low.
      case "new_prescription":
        return { title: "New prescription", body: "A new prescription was added to a record you help manage.", url: "/prescriptions" };
      case "new_test_result":
        return { title: "New test result", body: "A new test result was added to a record you help manage.", url: "/tests" };
      case "refill_low": {
        const url = `/medicines/${notification.patientMedicationId}`;
        return fullName
          ? { title: medicationName!, body: "Supply is projected to run out within a few days.", url }
          : { title: "Running low", body: "A medicine you help manage is running low.", url };
      }
      // V2 Phase 17. For these two kinds `medicationName` carries the
      // schedule label / concept label instead; the same privacy rule
      // applies — a label like "HbA1c" names a condition as surely as a
      // medicine name does, so it is generic unless the profile opted in.
      case "test_due":
        return fullName
          ? { title: `${medicationName!} is due`, body: "A test you track is due. Open the app to plan it.", url: "/tests" }
          : { title: "Test due", body: "A test you track is due. Open the app to plan it.", url: "/tests" };
      case "measurement_reminder":
        return fullName
          ? { title: `Record your ${medicationName!}`, body: "Time for a measurement you asked to be reminded about.", url: "/measurements" }
          : { title: "Measurement reminder", body: "Time for a measurement you asked to be reminded about.", url: "/measurements" };
      // Break-glass notice (docs_v2/10 H-49): always generic — the notice
      // itself must not leak anything about why the record was opened.
      case "system":
        return { title: "Record access notice", body: "An administrator viewed your record for support. Open the app for details.", url: "/settings/access-log" };
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

function digestPayload(kind: string, count: number): WebPushPayload {
  const what =
    kind === "new_prescription" ? "new prescription(s)" : kind === "new_test_result" ? "new test result(s)" : kind === "refill_low" ? "medicine(s) running low" : "update(s)";
  return { title: "Daily summary", body: `${count} ${what} today. Open the app to review.`, url: "/" };
}

/** Owner + any caregiver with reminder-management scope (docs/16 consented escalation). */
export async function resolveRecipients(
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
  // consent was granted (ConsentsController cascade).
  const wantedChannels: NotificationChannelKind[] = ["sms", "email"];
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
  return resolveCaregiverRecipients(prisma, profileId, ["manage_reminders", "full_management"], null);
}

async function resolveCaregiverRecipients(
  prisma: PrismaClient,
  profileId: string,
  scopes: readonly string[],
  excludeUserId: string | null,
): Promise<Recipient[]> {
  const caregivers = await prisma.caregiverRelationship.findMany({
    where: {
      patientProfileId: profileId,
      status: "active",
      caregiverUserId: { not: null, ...(excludeUserId ? { notIn: [excludeUserId] } : {}) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      permissions: { some: { scope: { in: [...scopes] as never }, revokedAt: null } },
    },
    select: { caregiverUserId: true },
  });
  if (caregivers.length === 0) return [];
  const channels = await prisma.notificationChannel.findMany({
    where: { userId: { in: caregivers.map((c) => c.caregiverUserId!) }, channel: { in: ["sms", "web_push", "email"] }, status: "active" },
  });
  return channels.map((c) => ({ channelId: c.id, channel: c.channel, addressCiphertext: c.addressCiphertext }));
}

async function recipientsFor(prisma: PrismaClient, notification: PendingNotification, control: KindControl): Promise<Recipient[]> {
  const pref = notification.patientProfile.notificationPreference;
  let recipients: Recipient[];
  if (notification.kind === "caregiver_escalation" || notification.kind === "dose_correction") {
    recipients = await resolveEscalationRecipients(prisma, notification.patientProfileId);
  } else if (isCaregiverKind(notification.kind)) {
    recipients = await resolveCaregiverRecipients(prisma, notification.patientProfileId, caregiverScopesFor(notification.kind), notification.triggeredByUserId);
  } else {
    recipients = await resolveRecipients(prisma, notification.patientProfileId, notification.patientProfile.ownerUserId, pref);
  }
  return recipients.filter((r) => channelAllowed(control, r.channel));
}

/**
 * The name a message may carry (subject to the profile's privacy mode):
 * the medicine for medication kinds; for the P17 kinds, whose Notification
 * row has no free-text column, the schedule label / concept label resolved
 * from the dedupe key the detector minted.
 */
async function subjectLabelFor(prisma: PrismaClient, notification: PendingNotification): Promise<string | undefined> {
  if (notification.kind === "test_due") {
    const parsed = parseTestDueKey(notification.dedupeKey);
    if (!parsed) return undefined;
    const schedule = await prisma.testDueSchedule.findUnique({ where: { id: parsed.scheduleId }, select: { label: true } });
    return schedule?.label;
  }
  if (notification.kind === "measurement_reminder") {
    const parsed = parseMeasurementReminderKey(notification.dedupeKey);
    return parsed ? measurementConceptLabel(parsed.concept) : undefined;
  }
  return notification.scheduledDose?.medicationSchedule.patientMedication.enteredName ?? notification.patientMedication?.enteredName;
}

function settleStatus(kind: string, anySent: boolean): "done" | "pending" | "cancelled" {
  if (anySent) return "done";
  return KEEP_PENDING_KINDS.has(kind) ? "pending" : "cancelled";
}

export async function dispatchPendingNotifications(prisma: PrismaClient, deps: DispatchDeps): Promise<DispatchSummary> {
  const { pushSender, smsSender, config, log } = deps;
  const now = deps.now ?? new Date();
  const summary: DispatchSummary = { sent: 0, deferred: 0, cancelled: 0, digested: 0, capped: 0 };

  const pending: PendingNotification[] = await prisma.notification.findMany({
    where: { status: "pending", kind: { in: [...DISPATCHED_KINDS] } },
    include: {
      patientProfile: { include: { notificationPreference: true } },
      scheduledDose: { include: { medicationSchedule: { include: { patientMedication: true } } } },
      patientMedication: true,
    },
    orderBy: { createdAt: "asc" },
  });

  /** Digest batches, keyed `profileId|kind`, collected while walking the immediate rows. */
  const digests = new Map<string, PendingNotification[]>();

  for (const notification of pending) {
    const pref = notification.patientProfile.notificationPreference;
    const control = controlFor(pref?.channelFrequencyJson, notification.kind);

    if (control.frequency === "off") {
      // The patient said no. A refill/completion row is still a true fact
      // on the in-app list, so it stays; everything else has no other
      // surface and is cancelled.
      if (!KEEP_PENDING_KINDS.has(notification.kind)) {
        await prisma.notification.update({ where: { id: notification.id }, data: { status: "cancelled" } });
        summary.cancelled++;
      }
      continue;
    }

    if (control.frequency === "daily_digest") {
      const key = `${notification.patientProfileId}|${notification.kind}`;
      const batch = digests.get(key) ?? [];
      batch.push(notification);
      digests.set(key, batch);
      continue;
    }

    const bypassQuietHours = notification.kind === "caregiver_escalation" && notification.patientMedication?.criticalEscalation === true;
    if (pref && isWithinQuietHours(pref, notification.patientProfile.timezone, now) && !bypassQuietHours) {
      summary.deferred++;
      continue;
    }

    const recipients = await recipientsFor(prisma, notification, control);
    if (recipients.length === 0) {
      if (CANCEL_WHEN_UNDELIVERABLE.has(notification.kind)) {
        await prisma.notification.update({ where: { id: notification.id }, data: { status: "cancelled" } });
        summary.cancelled++;
      }
      continue;
    }

    // P17 overload guardrail (H-48): at most N sends per (profile, kind)
    // per calendar day. Protected kinds have no cap by construction. A row
    // past the cap is cancelled — or, for kinds whose in-app list is the
    // source of truth, left pending so tomorrow's tick can still send it.
    const cap = control.protected ? undefined : dailyCapFor(notification.kind);
    if (cap !== undefined) {
      const withinCap = await checkAndIncrementDailyCap(prisma, `notification_daily:${notification.patientProfileId}:${notification.kind}`, cap, now);
      if (!withinCap) {
        log.warn({ profileId: notification.patientProfileId, kind: notification.kind, cap }, "daily per-kind notification cap reached — not sending");
        summary.capped++;
        if (!KEEP_PENDING_KINDS.has(notification.kind)) {
          await prisma.notification.update({ where: { id: notification.id }, data: { status: "cancelled" } });
          summary.cancelled++;
        }
        continue;
      }
    }

    const medicationName = await subjectLabelFor(prisma, notification);
    const anySent = await sendToRecipients(prisma, deps, notification, recipients, {
      push: buildPushPayload(notification, medicationName, pref),
      smsTemplate: notification.kind,
      smsParams: { medicationName: notification.privacyMode === "full_name" ? (medicationName ?? "") : "" },
      urgency: LOUD_KINDS.has(notification.kind) ? "high" : "normal",
    });
    await prisma.notification.update({ where: { id: notification.id }, data: { status: settleStatus(notification.kind, anySent) } });
    if (anySent) summary.sent++;
  }

  // --- Daily digests: one send per (profile, kind) per morning. ---
  for (const batch of digests.values()) {
    const first = batch[0]!;
    const timezone = first.patientProfile.timezone;
    const due = batch.filter((n) => digestDecision(n.createdAt, timezone, now) === "send");
    if (due.length === 0) {
      summary.deferred += batch.length;
      continue;
    }
    const pref = first.patientProfile.notificationPreference;
    const control = controlFor(pref?.channelFrequencyJson, first.kind);
    // Recipients are those of the newest row; for caregiver kinds this
    // excludes whoever triggered it, which is the same person for a
    // single-row digest and a reasonable stand-in for a mixed one.
    const recipients = await recipientsFor(prisma, due[due.length - 1]!, control);
    if (recipients.length === 0) {
      if (CANCEL_WHEN_UNDELIVERABLE.has(first.kind)) {
        await prisma.notification.updateMany({ where: { id: { in: due.map((n) => n.id) } }, data: { status: "cancelled" } });
        summary.cancelled += due.length;
      }
      summary.deferred += batch.length - due.length;
      continue;
    }
    // One send per recipient carries the whole batch; every folded row
    // gets its own attempt so the delivery truth table stays per-row.
    const anySent = await sendToRecipients(prisma, deps, due, recipients, {
      push: digestPayload(first.kind, due.length),
      smsTemplate: "daily_digest",
      smsParams: { medicationName: String(due.length) },
      urgency: "normal",
    });
    await prisma.notification.updateMany({
      where: { id: { in: due.map((n) => n.id) } },
      data: { status: anySent ? "done" : KEEP_PENDING_KINDS.has(first.kind) ? "pending" : "cancelled" },
    });
    if (anySent) {
      summary.sent++;
      summary.digested += due.length;
    }
    summary.deferred += batch.length - due.length;
  }

  log.info({ ...summary }, "dispatch-notifications completed");
  return summary;
}

/**
 * Sends one message to every recipient and records an attempt per
 * (notification, recipient). `target` is one row or a digest batch.
 */
async function sendToRecipients(
  prisma: PrismaClient,
  deps: DispatchDeps,
  target: PendingNotification | PendingNotification[],
  recipients: Recipient[],
  message: { push: WebPushPayload; smsTemplate: string; smsParams: Record<string, string>; urgency: "high" | "normal" },
): Promise<boolean> {
  const { pushSender, smsSender, emailSender, config, log } = deps;
  const rows = Array.isArray(target) ? target : [target];
  const first = rows[0]!;
  let anySent = false;

  const attempt = async (recipient: Recipient, data: { status: "sent" | "failed"; errorDigest?: string; providerMessageId?: string }) => {
    await prisma.notificationAttempt.createMany({
      data: rows.map((n) => ({
        notificationId: n.id,
        notificationChannelId: recipient.channelId,
        channel: recipient.channel,
        status: data.status,
        errorDigest: data.errorDigest,
        providerMessageId: data.providerMessageId,
      })),
    });
  };

  for (const recipient of recipients) {
    try {
      if (recipient.channel === "web_push") {
        if (!pushSender) throw new Error("web_push channel exists but VAPID keys aren't configured");
        const subscription = decryptWebPushSubscription(recipient.addressCiphertext, config);
        const result = await pushSender.send(subscription, message.push, { urgency: message.urgency });
        if (result.ok) {
          anySent = true;
          await attempt(recipient, { status: "sent" });
        } else {
          await attempt(recipient, { status: "failed", errorDigest: `http_${result.statusCode ?? "unknown"}` });
          if (result.gone) {
            await prisma.notificationChannel.update({ where: { id: recipient.channelId }, data: { status: "revoked" } });
          }
        }
      } else if (recipient.channel === "sms") {
        if (!smsSender) throw new Error("sms channel exists but TELNYX_API_KEY/TELNYX_FROM_NUMBER aren't configured");
        if (CAPPED_SMS_KINDS.has(first.kind)) {
          const withinCap = await checkAndIncrementDailyCap(prisma, `sms_reminder_daily:${first.patientProfileId}`, SMS_REMINDER_DAILY_CAP);
          if (!withinCap) {
            log.warn({ profileId: first.patientProfileId, kind: first.kind }, "daily SMS reminder cap reached — skipping this non-critical send");
            continue;
          }
        }
        const phoneE164 = decryptPlaintext(recipient.addressCiphertext, config);
        const { providerMessageId } = await smsSender.sendTemplate(phoneE164, message.smsTemplate, message.smsParams);
        anySent = true;
        await attempt(recipient, { status: "sent", providerMessageId });
      } else if (recipient.channel === "email") {
        // P17 email channel. Only the log transport exists, so this records
        // an attempt and a PHI-free log line; nothing leaves the process.
        if (!emailSender) throw new Error("email channel exists but no email transport is configured");
        const address = decryptPlaintext(recipient.addressCiphertext, config);
        const { providerMessageId } = await emailSender.sendTemplate(address, message.smsTemplate, message.smsParams);
        anySent = true;
        await attempt(recipient, { status: "sent", providerMessageId });
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown";
      log.error({ channelId: recipient.channelId, channel: recipient.channel, err: errorMessage }, "reminder send failed");
      await attempt(recipient, { status: "failed", errorDigest: errorMessage.slice(0, 200) });
    }
  }
  return anySent;
}
