"use client";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KINDS_NEVER_MUTED,
  type NotificationChannel,
  type NotificationFrequency,
  type NotificationKind,
} from "@medpass/domain";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

/**
 * Per-kind notification controls (docs_v2/04 §12, docs_v2/06 P6-4). The
 * preferences object also carries the V1 push/quiet-hours settings, which
 * `ReminderSettings` owns; this module only reads them so a PUT can send
 * them back unchanged.
 *
 * Hazard H-48 is the reason this file exists and also the reason it is
 * careful: the control is there so people stop muting *everything* when a
 * refill nudge annoys them. That only helps if the two kinds that must
 * always arrive cannot be turned down — so `dose_reminder` and
 * `caregiver_escalation` are rejected by the API with a 400, and are
 * stripped here before every write rather than sent and refused.
 */

export interface ChannelFrequencyEntry {
  channels: NotificationChannel[];
  frequency: NotificationFrequency;
}

export interface NotificationPreferencesDto {
  pushEnabled: boolean;
  privacyMode: "generic" | "full_name";
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  /** Absent on older rows; every reader must treat a missing kind as the default. */
  channelFrequency?: Partial<Record<string, ChannelFrequencyEntry>>;
}

/**
 * The kinds this screen offers a control for, grouped the way a patient
 * thinks about them rather than by the enum's order.
 *
 * Two deliberate absences:
 * - `dose_reminder` and `caregiver_escalation` are rendered separately, as
 *   always-on with a reason (see NEVER_MUTED below).
 * - `unusual_measurement` has no control because it has no sender: the
 *   alert ships only behind a Safety-Board-approved rule (docs_v2/10 H-41),
 *   and a switch for something that can never fire is a false promise.
 */
export const NOTIFICATION_GROUPS: ReadonlyArray<{ id: string; kinds: readonly NotificationKind[] }> = [
  { id: "medicines", kinds: ["missed_dose", "dose_correction", "refill", "refill_low", "completion"] },
  { id: "tests", kinds: ["new_test_result", "test_due", "measurement_reminder", "follow_up"] },
  { id: "safety", kinds: ["safety_finding"] },
  { id: "care", kinds: ["new_prescription"] },
  { id: "app", kinds: ["system"] },
];

export const CONFIGURABLE_KINDS: readonly NotificationKind[] = NOTIFICATION_GROUPS.flatMap((g) => [...g.kinds]);

/** The two kinds no preference may turn down (docs_v2/10 H-48). */
export const NEVER_MUTED_KINDS: readonly NotificationKind[] = NOTIFICATION_KINDS_NEVER_MUTED;

/**
 * Offered channels. `email` is carried end to end by the API but only the
 * `log` transport exists until a mail provider is chosen (docs_v2/04 §12),
 * so it is not offered here — a channel that silently sends nothing is
 * worse than one that is absent.
 */
export const OFFERED_CHANNELS: readonly NotificationChannel[] = ["web_push", "sms"];

export const DEFAULT_ENTRY: ChannelFrequencyEntry = { channels: ["web_push"], frequency: "immediate" };

export function entryFor(prefs: NotificationPreferencesDto | undefined, kind: NotificationKind): ChannelFrequencyEntry {
  const stored = prefs?.channelFrequency?.[kind];
  if (!stored) return DEFAULT_ENTRY;
  return { channels: stored.channels ?? [], frequency: stored.frequency ?? "immediate" };
}

const PATH = "/profiles/current/notification-preferences";

export function useNotificationPreferences() {
  const { data, error, reload, mutate } = useSharedResource<NotificationPreferencesDto>({
    path: PATH,
    fetcher: () => api.get<NotificationPreferencesDto>(PATH, { profileId: getActiveProfileId() }),
  });
  return { prefs: data, error, reload, mutate };
}

/**
 * Replaces the whole preferences object, `channelFrequency` included.
 *
 * POST, not PUT: the API's two handlers are the same full replace over the
 * same row ("POST stays for the V1 client; both write the one row"), and
 * the shared api-client has no `put` — reaching for one would mean editing
 * a package three other apps share to gain nothing.
 *
 * The two never-muted kinds are stripped on the way out: the server would
 * answer 400, and the point of the screen is that they were never offered.
 *
 * One caveat this client cannot fix: a measurement-reminder plan written
 * before that column existed lives under a reserved key inside the same
 * `channelFrequencyJson`, and the GET filters it out before we ever see it
 * — so a full replace from here drops it. Preserving it has to happen
 * server-side, in `updatePreferences`, which is the only place that can
 * still read the key.
 */
export async function saveNotificationPreferences(prefs: NotificationPreferencesDto): Promise<NotificationPreferencesDto> {
  // Two filters, both needed. The never-muted kinds are refused by name
  // (H-48). Unknown keys are a hard validation error rather than a dropped
  // field, and the GET's tolerant reader passes through any key that merely
  // has the right *shape* — so a stray key in an old row would otherwise
  // make every save on this screen fail with nothing the patient can do.
  const channelFrequency = Object.fromEntries(
    Object.entries(prefs.channelFrequency ?? {}).filter(
      ([kind]) =>
        (NOTIFICATION_KINDS as readonly string[]).includes(kind) && !NEVER_MUTED_KINDS.includes(kind as NotificationKind),
    ),
  );
  const res = await api.post<NotificationPreferencesDto>(
    PATH,
    { ...prefs, channelFrequency },
    { profileId: getActiveProfileId() },
  );
  invalidate("profile", PATH);
  return res;
}
