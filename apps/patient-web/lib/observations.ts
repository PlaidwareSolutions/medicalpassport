"use client";
import { useEffect } from "react";
import type {
  MeasurementDeviceKind,
  MeasurementDevicePlatform,
  ObservationConcept,
  ObservationContext,
  ObservationInterpretation,
  TrendBucket,
  TrendWindow,
} from "@medpass/domain";
import { ApiError } from "@medpass/api-client";
import { enqueueMutation, type SyncChangeSignal } from "@medpass/offline-sync";
import { api, getActiveProfileId, newIdempotencyKey } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { invalidateHealthTimeline, type ProvenanceSource, type VerificationState } from "./health-timeline";
import { notifyMutationQueued, REMOTE_CHANGE_EVENT } from "./offline";

/**
 * Observations (docs_v2/04 §5, docs_v2/06 P5-3): every home measurement in
 * one generic shape — the V2 successor of the three V1 diaries (glucose,
 * BP, weight), which the server mirrors into this table. The hub shows the
 * latest per concept; each concept has its own diary and trend.
 *
 * Nothing here interprets a value (docs_v2/10 §1, H-25): no band, no
 * threshold, no "high"/"low". `interpretation` is read from the server for
 * provider/lab-sourced rows only and is never sent by this client
 * (`interpretation_not_client_settable`).
 */

export interface ObservationDto {
  id: string;
  concept: ObservationConcept;
  label: string;
  /** Canonical value(s), string over JSON. BP uses both (systolic/diastolic). */
  valueNumeric: string | null;
  valueNumeric2: string | null;
  valueText: string | null;
  /** Canonical unit per concept (mmHg, mg/dL, kg, °C, %, …). */
  unit: string;
  enteredUnit: string | null;
  enteredValueText: string | null;
  context: ObservationContext | null;
  bodySite: string | null;
  method: string | null;
  measuredAt: string;
  /** Wall clock in the patient's zone, "YYYY-MM-DDTHH:mm:ss" — the time shown. */
  measuredAtLocal: string | null;
  interpretation: ObservationInterpretation | null;
  notes: string | null;
  deviceId: string | null;
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
  createdAt: string;
}

export interface ObservationInput {
  concept: ObservationConcept;
  measuredAt: string;
  valueNumeric?: number;
  valueNumeric2?: number;
  valueText?: string;
  /** What the patient typed the value in (e.g. "°F"); the server converts to canonical. */
  enteredUnit?: string;
  enteredValueText?: string;
  /** BP only: the cuff's pulse, stored as its own heart_rate observation. */
  pulseBpm?: number;
  context?: ObservationContext;
  bodySite?: string;
  method?: string;
  notes?: string;
  deviceId?: string;
}

export interface TrendPointDto {
  /** Bucket key: "YYYY-MM-DD" (day / week start) or "YYYY-MM" (month). */
  bucket: string;
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
  average2: number | null;
  min2: number | null;
  max2: number | null;
  morning: { count: number; average: number | null };
  evening: { count: number; average: number | null };
  rollingAverage: number;
}

export interface ObservationTrendDto {
  concept: ObservationConcept;
  label: string;
  unit: string | null;
  unitDisplay: string | null;
  window: TrendWindow;
  bucket: TrendBucket;
  from: string;
  to: string;
  timezone: string;
  points: TrendPointDto[];
  summary: Omit<TrendPointDto, "bucket" | "rollingAverage">;
}

export interface MeasurementDeviceDto {
  id: string;
  kind: MeasurementDeviceKind;
  platform: MeasurementDevicePlatform;
  manufacturer: string | null;
  model: string | null;
  label: string | null;
  status: "active" | "retired";
  lastSyncAt: string | null;
  observationCount?: number;
  createdAt: string;
}

export interface MeasurementDeviceInput {
  kind: MeasurementDeviceKind;
  label?: string;
  manufacturer?: string;
  model?: string;
  platform?: MeasurementDevicePlatform;
}

export interface ObservationConceptDto {
  key: ObservationConcept;
  display: string;
  canonicalUnit: string | null;
  canonicalUnitDisplay: string | null;
  allowedEnteredUnits: Array<{ unit: string; display: string; isCanonical: boolean }>;
  hasTwoValues: boolean;
  plausibility: { min: number; max: number } | null;
  components: Array<{ slot: "valueNumeric" | "valueNumeric2"; display: string; plausibility: { min: number; max: number } }> | null;
}

const LIST_PATH = "/profiles/current/observations";
const DEVICES_PATH = "/profiles/current/measurement-devices";
const TRENDS_PATH = "/profiles/current/trends/observations";
const TERMINOLOGY_PATH = "/terminology/observation-concepts";

function bust(): void {
  invalidate("profile", LIST_PATH);
  invalidate("profile", TRENDS_PATH);
  invalidate("profile", "/observations/");
  invalidateHealthTimeline();
}

/** All observations (newest first), or one concept's when given. */
export function useObservations(concept?: ObservationConcept) {
  const path = concept ? `${LIST_PATH}?concept=${concept}` : LIST_PATH;
  const { data, error, reload, fromCache } = useSharedResource<ObservationDto[]>({
    path,
    fetcher: async () => (await api.get<{ items: ObservationDto[] }>(path, { profileId: getActiveProfileId() })).items,
  });

  // A reading that landed from elsewhere — another device, or this device's
  // own offline queue replaying (docs_v2/05 §14) — reloads the diary the
  // same way the medicines list does (docs/15 incremental sync).
  useEffect(() => {
    function onRemoteChange(e: Event) {
      const change = (e as CustomEvent<SyncChangeSignal>).detail;
      if (change.scope === "observations" && change.profileId === getActiveProfileId()) {
        bust();
        void reload();
      }
    }
    window.addEventListener(REMOTE_CHANGE_EVENT, onRemoteChange);
    return () => window.removeEventListener(REMOTE_CHANGE_EVENT, onRemoteChange);
  }, [reload]);

  return { items: data, error, reload, fromCache };
}

export function useObservationTrend(concept: ObservationConcept, window: TrendWindow, bucket: TrendBucket) {
  const path = `${TRENDS_PATH}/${concept}?window=${window}&bucket=${bucket}`;
  const { data, error, reload } = useSharedResource<ObservationTrendDto>({
    path,
    fetcher: () => api.get<ObservationTrendDto>(path, { profileId: getActiveProfileId() }),
  });
  return { trend: data, error, reload };
}

export function useObservationConcepts() {
  const { data, error } = useSharedResource<ObservationConceptDto[]>({
    path: TERMINOLOGY_PATH,
    scope: "user",
    ttlMs: 60 * 60_000,
    fetcher: async () => (await api.get<{ items: ObservationConceptDto[] }>(TERMINOLOGY_PATH)).items,
  });
  return { concepts: data, error };
}

/**
 * Records a reading. With no connection — `navigator.onLine` false, or the
 * request failing without an HTTP answer — the reading is queued for
 * `POST /v1/sync` (docs_v2/05 §14 `observation/create`) instead of being
 * lost, exactly as an offline dose is. The clientMutationId travels in the
 * body on the online path too, so a request that did reach the server but
 * whose answer never came back is not recorded twice on replay. A real
 * rejection (an implausible value, a refused unit) is thrown, never queued:
 * the server's checks are the same offline (H-25 stays server-side).
 */
export async function createObservation(input: ObservationInput): Promise<{ queuedOffline: boolean; observation?: ObservationDto }> {
  const profileId = getActiveProfileId();
  const clientMutationId = newIdempotencyKey();
  const payload = { ...input, clientMutationId };

  async function queue(): Promise<{ queuedOffline: true }> {
    if (!profileId) throw new Error("no_active_profile");
    await enqueueMutation({ clientMutationId, entity: "observation", operation: "create", payload, capturedAt: new Date().toISOString(), profileId });
    notifyMutationQueued();
    return { queuedOffline: true };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) return queue();
  try {
    const res = await api.post<ObservationDto>(LIST_PATH, payload, { profileId });
    bust();
    return { queuedOffline: false, observation: res };
  } catch (err) {
    if (err instanceof ApiError || !profileId) throw err; // a real rejection — never hide it
    return queue();
  }
}

export async function deleteObservation(id: string) {
  await api.delete(`/observations/${id}`, { profileId: getActiveProfileId() });
  bust();
}

export function useMeasurementDevices() {
  const { data, error, reload } = useSharedResource<MeasurementDeviceDto[]>({
    path: DEVICES_PATH,
    fetcher: async () => (await api.get<{ items: MeasurementDeviceDto[] }>(DEVICES_PATH, { profileId: getActiveProfileId() })).items,
  });
  return { items: data, error, reload };
}

export async function createMeasurementDevice(input: MeasurementDeviceInput) {
  const res = await api.post<MeasurementDeviceDto>(DEVICES_PATH, input, { profileId: getActiveProfileId() });
  invalidate("profile", DEVICES_PATH);
  return res;
}

export async function updateMeasurementDevice(id: string, patch: Partial<MeasurementDeviceInput> & { status?: "active" | "retired" }) {
  const res = await api.patch<MeasurementDeviceDto>(`/measurement-devices/${id}`, patch, { profileId: getActiveProfileId() });
  invalidate("profile", DEVICES_PATH);
  return res;
}

export async function deleteMeasurementDevice(id: string) {
  await api.delete(`/measurement-devices/${id}`, { profileId: getActiveProfileId() });
  invalidate("profile", DEVICES_PATH);
}

// --- hub concepts and pure helpers (unit-tested) ------------------------

/** The concepts with their own diary card, in hub order; everything else stays reachable through the timeline. */
export const HUB_CONCEPTS = [
  "blood_pressure",
  "blood_glucose",
  "body_weight",
  "spo2",
  "body_temperature",
  "heart_rate",
  "body_height",
  "pain_score",
] as const satisfies readonly ObservationConcept[];
export type HubConcept = (typeof HUB_CONCEPTS)[number];

export function isHubConcept(v: string | undefined): v is HubConcept {
  return (HUB_CONCEPTS as readonly string[]).includes(v ?? "");
}

/** Hand-drawn glyph per concept (docs/33: never emoji). */
export function conceptGlyph(concept: HubConcept): "heart" | "drop" | "scale" | "pulse" | "cross" | "timeline" {
  switch (concept) {
    case "blood_pressure":
      return "heart";
    case "blood_glucose":
      return "drop";
    case "body_weight":
      return "scale";
    case "heart_rate":
    case "spo2":
      return "pulse";
    case "body_temperature":
      return "cross";
    default:
      return "timeline";
  }
}

/** The V1 diary routes, mapped onto their hub concept pages. */
export const LEGACY_DIARY_ROUTES: Readonly<Record<"blood-sugar" | "blood-pressure" | "body-weight", HubConcept>> = {
  "blood-sugar": "blood_glucose",
  "blood-pressure": "blood_pressure",
  "body-weight": "body_weight",
};

/** The glucose contexts a patient can choose (the BP/positional ones are separate). */
export const GLUCOSE_CONTEXTS: readonly ObservationContext[] = [
  "before_breakfast",
  "after_breakfast",
  "before_lunch",
  "after_lunch",
  "before_dinner",
  "after_dinner",
  "during_night",
  "fasting",
  "random",
];

/** Contexts for a BP cuff reading: posture and situation. */
export const BP_CONTEXTS: readonly ObservationContext[] = ["sitting", "standing", "lying", "resting", "post_exercise", "morning", "evening"];

/** Newest observation per concept, in hub order — the hub card data. */
export function latestPerConcept(items: readonly ObservationDto[]): Map<ObservationConcept, ObservationDto> {
  const out = new Map<ObservationConcept, ObservationDto>();
  for (const o of items) {
    const current = out.get(o.concept);
    if (!current || o.measuredAt > current.measuredAt) out.set(o.concept, o);
  }
  return out;
}

/** Trims "12.000" → "12", "36.500" → "36.5" — server decimals carry fixed scale. */
export function trimDecimal(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v);
  return String(Math.round(n * 1000) / 1000);
}

/**
 * The reading as one plain string in its canonical unit: "120/80 mmHg",
 * "98 mg/dL", "72.5 kg". Text-only concepts show their text. No verdict
 * ever rides along with the number.
 */
export function observationValueText(o: Pick<ObservationDto, "concept" | "valueNumeric" | "valueNumeric2" | "valueText" | "unit">): string {
  if (o.concept === "blood_pressure" && o.valueNumeric != null && o.valueNumeric2 != null) {
    return `${trimDecimal(o.valueNumeric)}/${trimDecimal(o.valueNumeric2)} ${displayUnit(o.concept, o.unit)}`.trim();
  }
  if (o.valueNumeric != null) {
    if (o.concept === "pain_score") return `${trimDecimal(o.valueNumeric)} / 10`;
    return `${trimDecimal(o.valueNumeric)} ${displayUnit(o.concept, o.unit)}`.trim();
  }
  return o.valueText ?? "";
}

/** "HH:MM" wall clock from `measuredAtLocal`; null when the row predates the column. */
export function localClock(o: Pick<ObservationDto, "measuredAtLocal">): { hour: number; minute: number } | null {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(o.measuredAtLocal ?? "");
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/** Morning is before noon on the patient's own clock (the server's split rule, mirrored for the diary). */
export function isMorning(o: Pick<ObservationDto, "measuredAtLocal">): boolean | null {
  const clock = localClock(o);
  return clock ? clock.hour < 12 : null;
}

/** The trend bucket label a patient reads: a date for day/week, a month for month. */
export function bucketLabel(bucket: string, kind: TrendBucket, locale?: string): string {
  const lang = locale === "en" ? undefined : locale;
  if (kind === "month") {
    const [y, m] = bucket.split("-").map(Number);
    return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleDateString(lang, { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const [y, m, d] = bucket.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(lang, { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The stored `unit` is a UCUM code (`mm[Hg]`, `Cel`, `/min`); patients read
 * the printed form. Hub concepts map by concept (pulse is "bpm", breathing
 * "/min"); anything else falls back to the code table, then the code itself.
 */
const CONCEPT_UNIT_DISPLAY: Partial<Record<ObservationConcept, string>> = {
  blood_pressure: "mmHg",
  heart_rate: "bpm",
  body_temperature: "°C",
  pain_score: "0–10",
  bmi: "kg/m²",
  inr: "ratio",
  sleep_hours: "hours",
  steps: "steps",
  insulin_dose: "IU",
};
const UNIT_CODE_DISPLAY: Record<string, string> = {
  "mm[Hg]": "mmHg",
  Cel: "°C",
  "[degF]": "°F",
  "[lb_av]": "lb",
  "[in_i]": "in",
  "kg/m2": "kg/m²",
  "{score}": "0–10",
  "{INR}": "ratio",
  "{steps}": "steps",
  "[IU]": "IU",
  "10*6/uL": "million/µL",
  "10*3/uL": "thousand/µL",
  "10*9/L": "×10⁹/L",
  "10*12/L": "×10¹²/L",
  umol_L: "µmol/L",
  "umol/L": "µmol/L",
  "ug/dL": "µg/dL",
  "ng/mL": "ng/mL",
  "ug/L": "µg/L",
  "mmol/mol": "mmol/mol",
};

export function displayUnit(concept: ObservationConcept | undefined, unit: string | null | undefined): string {
  if (!unit) return "";
  if (concept && CONCEPT_UNIT_DISPLAY[concept]) return CONCEPT_UNIT_DISPLAY[concept]!;
  return UNIT_CODE_DISPLAY[unit] ?? unit;
}
