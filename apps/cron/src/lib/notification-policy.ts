/**
 * Per-kind delivery policy for the dispatch pass (docs_v2/04 §12, roadmap
 * §26 "avoid notification overload"; hazard H-48). Pure functions — the
 * dispatcher reads `NotificationPreference.channelFrequencyJson` and asks
 * here what to do; the API validates the same shape on write
 * (packages/validation notifications.ts) and both read the same domain
 * constants, so a kind that can never be muted is refused at the door AND
 * ignored here even if a row was written by hand.
 */
import { PROFILE_SCOPE_GRANTS } from "@medpass/authorization";
import {
  CAREGIVER_NOTIFICATION_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DAILY_CAP_BY_KIND,
  NOTIFICATION_KINDS_NEVER_MUTED,
  minutesSinceMidnightInTz,
  type CaregiverNotificationKind,
  type CaregiverScope,
  type NotificationChannel,
  type NotificationFrequency,
  type NotificationKind,
} from "@medpass/domain";

/**
 * P17 overload guardrail: the daily per-(profile, kind) send cap, or
 * undefined for kinds that are never capped. Protected kinds (H-48) are
 * absent from the domain table by construction, so this can never return a
 * number for `dose_reminder` or `caregiver_escalation`.
 */
export function dailyCapFor(kind: string): number | undefined {
  if ((NOTIFICATION_KINDS_NEVER_MUTED as readonly string[]).includes(kind)) return undefined;
  return NOTIFICATION_DAILY_CAP_BY_KIND[kind as NotificationKind];
}

export interface KindControl {
  /** Channels the patient allows for this kind; null means "every channel the profile has" (no control set). */
  channels: ReadonlySet<NotificationChannel> | null;
  frequency: NotificationFrequency;
  /** True when the kind is one this control can never touch (H-48) — the dispatcher treats it as immediate on every channel. */
  protected: boolean;
}

/** Local wall-clock hour at which a daily digest goes out, in the profile's own zone. */
export const DIGEST_LOCAL_MINUTES = 8 * 60;

/** Tolerant read of the stored JSON (mirrors the API's `readChannelFrequency`): malformed rows read as "no control", never as a crash. */
export function readChannelFrequency(raw: unknown): Record<string, { channels: NotificationChannel[]; frequency: NotificationFrequency }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { channels: NotificationChannel[]; frequency: NotificationFrequency }> = {};
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as { channels?: unknown; frequency?: unknown };
    if (!Array.isArray(entry.channels)) continue;
    const frequency = entry.frequency === "daily_digest" || entry.frequency === "off" ? entry.frequency : "immediate";
    out[kind] = {
      channels: entry.channels.filter((c): c is NotificationChannel => (NOTIFICATION_CHANNELS as readonly unknown[]).includes(c)),
      frequency,
    };
  }
  return out;
}

/**
 * What the patient's control says about one kind. `dose_reminder` and
 * `caregiver_escalation` always come back immediate-on-every-channel no
 * matter what the JSON holds (H-48: the system never mutes a dose reminder).
 */
export function controlFor(channelFrequencyJson: unknown, kind: string): KindControl {
  if ((NOTIFICATION_KINDS_NEVER_MUTED as readonly string[]).includes(kind)) {
    return { channels: null, frequency: "immediate", protected: true };
  }
  const entry = readChannelFrequency(channelFrequencyJson)[kind];
  if (!entry) return { channels: null, frequency: "immediate", protected: false };
  return { channels: new Set(entry.channels), frequency: entry.frequency, protected: false };
}

/** Applies a control's channel filter to a recipient's channel. */
export function channelAllowed(control: KindControl, channel: string): boolean {
  return control.channels === null || control.channels.has(channel as NotificationChannel);
}

/**
 * The instant of today's digest slot (DIGEST_LOCAL_MINUTES local) in the
 * profile's zone. A notification created before this instant belongs to
 * this morning's digest once `now` has passed it; one created after waits
 * for tomorrow's — so a 10:00 arrival is never dressed up as "today's
 * digest" at 10:01.
 */
export function digestCutoff(timezone: string, now: Date): Date {
  const sinceMidnight = minutesSinceMidnightInTz(timezone, now);
  const localMidnight = now.getTime() - sinceMidnight * 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  return new Date(localMidnight + DIGEST_LOCAL_MINUTES * 60_000);
}

export type DigestDecision = "send" | "wait";

export function digestDecision(createdAt: Date, timezone: string, now: Date): DigestDecision {
  const cutoff = digestCutoff(timezone, now);
  if (now < cutoff) return "wait";
  return createdAt < cutoff ? "send" : "wait";
}

export function isCaregiverKind(kind: string): kind is CaregiverNotificationKind {
  return (CAREGIVER_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/**
 * Which caregiver scopes may receive a caregiver-facing kind — derived from
 * the authorization matrix, exactly as the API's queueing side does
 * (apps/api caregiver-notifications.ts): a caregiver hears about a record
 * precisely when they could open it themselves.
 */
export function caregiverScopesFor(kind: CaregiverNotificationKind): readonly CaregiverScope[] {
  switch (kind) {
    case "new_prescription":
    case "refill_low":
      return PROFILE_SCOPE_GRANTS.view_medications;
    case "new_test_result":
      return PROFILE_SCOPE_GRANTS.view_tests;
  }
}

/** Kinds with no in-app surface of their own: nothing left to do once a send is impossible, so they are cancelled rather than left pending. */
export const CANCEL_WHEN_UNDELIVERABLE = new Set<string>([
  "dose_reminder",
  "caregiver_escalation",
  "dose_correction",
  "new_prescription",
  "new_test_result",
  "refill_low",
  // P17: the schedule / reminder plan itself is the in-app surface; the row is only a nudge.
  "test_due",
  "measurement_reminder",
  // Break-glass notice: the audit chain and the admin's grant row are the record; the row is only the patient-facing ping.
  "system",
]);
