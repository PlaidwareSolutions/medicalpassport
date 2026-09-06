/**
 * `measurement_reminder` detection (docs_v2/06 P17): "record your blood
 * pressure at 08:00 and 20:00 on weekdays". The plan lives in
 * `NotificationPreference.measurementRemindersJson`; the API writes it, this
 * pass reads it. Rows written before that column existed kept the plan under
 * a reserved key inside `channelFrequencyJson` (MEASUREMENT_REMINDERS_JSON_KEY
 * in @medpass/domain), so both shapes are still accepted.
 *
 * One pending row per (profile, concept, local date, HH:MM) slot, minted
 * once the slot's wall-clock time has passed in the profile's own zone and
 * while it is still within `SLOT_WINDOW_MINUTES` — a slot missed by more
 * than that (downtime, a paused cron) is skipped rather than fired late,
 * since a stale "time to measure" nudge is noise, not help. The dedupe key
 * makes re-runs inside the window a no-op. Delivery (channels, digest,
 * quiet hours, the daily cap) is the dispatch pass's job.
 */
import { MEASUREMENT_REMINDERS_JSON_KEY, OBSERVATION_CONCEPTS, dateStringInTz, minutesSinceMidnightInTz, type ObservationConcept } from "@medpass/domain";
import type { PrismaClient } from "@medpass/database";

/** How long after its wall-clock time a slot may still fire. The job is scheduled every 5 minutes. */
export const SLOT_WINDOW_MINUTES = 15;

export interface MeasurementReminderPlan {
  times: string[];
  days: number[];
}
export type MeasurementReminderPlans = Partial<Record<ObservationConcept, MeasurementReminderPlan>>;

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Tolerant read: anything malformed reads as "no reminders", never as a
 * crash. Accepts either the plan itself (the column) or the pre-column
 * wrapper that carried it under a reserved key.
 */
export function readMeasurementReminders(stored: unknown): MeasurementReminderPlans {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const asRecord = stored as Record<string, unknown>;
  const raw = MEASUREMENT_REMINDERS_JSON_KEY in asRecord ? asRecord[MEASUREMENT_REMINDERS_JSON_KEY] : asRecord;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const concepts = (raw as { concepts?: unknown }).concepts;
  if (!concepts || typeof concepts !== "object" || Array.isArray(concepts)) return {};
  const out: MeasurementReminderPlans = {};
  for (const [concept, plan] of Object.entries(concepts as Record<string, unknown>)) {
    if (!(OBSERVATION_CONCEPTS as readonly string[]).includes(concept)) continue;
    if (!plan || typeof plan !== "object") continue;
    const { times, days } = plan as { times?: unknown; days?: unknown };
    if (!Array.isArray(times) || !Array.isArray(days)) continue;
    const cleanTimes = [...new Set(times.filter((t): t is string => typeof t === "string" && TIME_OF_DAY.test(t)))];
    const cleanDays = [...new Set(days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))];
    if (cleanTimes.length === 0 || cleanDays.length === 0) continue;
    out[concept as ObservationConcept] = { times: cleanTimes, days: cleanDays };
  }
  return out;
}

export function measurementReminderKey(profileId: string, concept: string, date: string, time: string): string {
  return `measurement_reminder:${profileId}:${concept}:${date}:${time}`;
}

export function parseMeasurementReminderKey(dedupeKey: string): { profileId: string; concept: ObservationConcept; date: string; time: string } | null {
  const m = /^measurement_reminder:([0-9a-f-]{36}):([a-z_]+):(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/i.exec(dedupeKey);
  if (!m || !(OBSERVATION_CONCEPTS as readonly string[]).includes(m[2]!)) return null;
  return { profileId: m[1]!, concept: m[2] as ObservationConcept, date: m[3]!, time: m[4]! };
}

/** Human label for a concept in reminder copy (only shown when the profile opted into `full_name`). */
export function measurementConceptLabel(concept: ObservationConcept): string {
  const labels: Partial<Record<ObservationConcept, string>> = {
    blood_pressure: "blood pressure",
    heart_rate: "heart rate",
    blood_glucose: "blood sugar",
    body_weight: "weight",
    body_height: "height",
    bmi: "BMI",
    spo2: "oxygen level",
    body_temperature: "temperature",
    respiratory_rate: "breathing rate",
    inr: "INR",
    peak_flow: "peak flow",
    pain_score: "pain score",
    insulin_dose: "insulin dose",
    fluid_intake: "fluid intake",
    fluid_output: "fluid output",
    waist_circumference: "waist measurement",
    steps: "steps",
    sleep_hours: "sleep",
  };
  return labels[concept] ?? "measurement";
}

/** ISO weekday (Mon = 1 … Sun = 7) of a `YYYY-MM-DD` calendar date. */
export function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // Sun = 0
  return day === 0 ? 7 : day;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Pure: which of a plan's slots are live at `now` for a profile in `timezone`. */
export function dueSlots(plan: MeasurementReminderPlan, timezone: string, now: Date, windowMinutes = SLOT_WINDOW_MINUTES): Array<{ date: string; time: string }> {
  const date = dateStringInTz(timezone, now);
  if (!plan.days.includes(isoWeekday(date))) return [];
  const nowMin = minutesSinceMidnightInTz(timezone, now);
  return plan.times.filter((t) => {
    const slot = toMinutes(t);
    return slot <= nowMin && nowMin - slot <= windowMinutes;
  }).map((time) => ({ date, time }));
}

export interface DetectMeasurementRemindersSummary {
  queued: number;
  profilesWithPlans: number;
}

export async function detectMeasurementReminders(prisma: PrismaClient, options: { now?: Date } = {}): Promise<DetectMeasurementRemindersSummary> {
  const now = options.now ?? new Date();
  const summary: DetectMeasurementRemindersSummary = { queued: 0, profilesWithPlans: 0 };

  // No JSON-null filter: both shapes are read tolerantly below and the table is small (one row per profile that touched its settings).
  const prefs = await prisma.notificationPreference.findMany({
    select: {
      patientProfileId: true,
      privacyMode: true,
      measurementRemindersJson: true,
      channelFrequencyJson: true,
      patientProfile: { select: { timezone: true, deletedAt: true } },
    },
  });

  for (const pref of prefs) {
    if (pref.patientProfile.deletedAt) continue;
    const fromColumn = readMeasurementReminders(pref.measurementRemindersJson);
    const plans = Object.keys(fromColumn).length > 0 ? fromColumn : readMeasurementReminders(pref.channelFrequencyJson);
    const concepts = Object.keys(plans) as ObservationConcept[];
    if (concepts.length === 0) continue;
    summary.profilesWithPlans++;

    for (const concept of concepts) {
      for (const slot of dueSlots(plans[concept]!, pref.patientProfile.timezone, now)) {
        const dedupeKey = measurementReminderKey(pref.patientProfileId, concept, slot.date, slot.time);
        const existing = await prisma.notification.findUnique({ where: { dedupeKey }, select: { id: true } });
        if (existing) continue;
        await prisma.notification.create({
          data: { patientProfileId: pref.patientProfileId, kind: "measurement_reminder", privacyMode: pref.privacyMode, dedupeKey, status: "pending" },
        });
        summary.queued++;
      }
    }
  }

  return summary;
}
