"use client";
import { useCallback, useState } from "react";
import type { MessageKey } from "@medpass/localization";
import { api, getActiveProfileId } from "./api";
import { useSharedResource } from "./data-cache";
import { eventGlyph, eventSentence, type EventGlyph, type HealthEventDto } from "./health-timeline";

/**
 * "Who changed what" (docs_v2/05 §8, docs_v2/06 P6-3): the patient-facing
 * record of what the people they gave access to actually did. The server
 * merges two sources — projected HealthEvents and audit rows — under one
 * keyset cursor, both already filtered to `actorType = caregiver`.
 *
 * The whole job on this side is turning that into sentences. An audit row
 * carries an action code and an entity id; neither belongs on a patient's
 * screen. Every row here resolves to a named phrase or a verb plus a plain
 * noun, and `entityId` is never rendered — a row we cannot phrase says
 * "made a change", which is true, rather than printing the code, which is
 * not readable.
 */

export interface ActivityItemDto {
  id: string;
  source: "health_event" | "audit";
  occurredAt: string;
  /** HealthEvent kind, for `source: "health_event"`. */
  kind: string | null;
  /** Audit action code, for `source: "audit"`. Never rendered. */
  action: string | null;
  entityType: string | null;
  /** An internal handle. Never rendered. */
  entityId: string | null;
  summary: unknown;
  actor: {
    actorType: string;
    /** The relationship the patient chose, not the caregiver's account. */
    relationship: string | null;
    /** The patient's own label for this person, when they set one. */
    label: string | null;
    relationshipId: string | null;
  };
}

export interface ActivityPageDto {
  items: ActivityItemDto[];
  nextCursor: string | null;
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

// --- who ----------------------------------------------------------------

/**
 * The person, in the patient's own terms: the label they gave first, then
 * the relationship, and only if neither exists the honest "someone you gave
 * access to". Never an account id, a phone number or an actor code.
 */
export function actorName(t: Translate, item: ActivityItemDto): string {
  if (item.actor.label) return item.actor.label;
  if (item.actor.relationship) return t(`caregiver.relationship.${item.actor.relationship}` as MessageKey);
  return t("activity.actor_unknown");
}

// --- what ---------------------------------------------------------------

/**
 * Audit actions whose plain phrasing is not "added/changed/removed a
 * thing". Anything absent falls through to the verb + noun rule below, so a
 * new server-side action degrades to a readable sentence, never to a code.
 */
const NAMED_ACTIONS: Readonly<Record<string, MessageKey>> = {
  "dose.recorded": "activity.action.dose_recorded",
  "dose.correction_notice_created": "activity.action.dose_correction",
  "medication.status_changed": "activity.action.medicine_status_changed",
  "medication.refill_recorded": "activity.action.refill_recorded",
  "medication.refill_plan_updated": "activity.action.refill_plan_updated",
  "medication.list_viewed": "activity.action.medicines_viewed",
  "document.upload_completed": "activity.action.document_added",
  "document.downloaded": "activity.action.document_downloaded",
  "extraction.field_confirmed": "activity.action.reading_confirmed",
  "extraction.field_rejected": "activity.action.reading_rejected",
  "extraction.materialized": "activity.action.document_details_saved",
  "diagnostic_result.corrected": "activity.action.result_corrected",
  "share.created": "activity.action.share_created",
  "share.revoked": "activity.action.share_revoked",
  "caregiver.invited": "activity.action.caregiver_invited",
  "caregiver.accepted": "activity.action.caregiver_accepted",
  "caregiver.scope_changed": "activity.action.caregiver_scope_changed",
  "caregiver.revoked": "activity.action.caregiver_revoked",
  "caregiver.dependent_created": "activity.action.dependent_created",
  "profile.updated": "activity.action.profile_updated",
  "notification.preferences_updated": "activity.action.reminders_changed",
  "notification.measurement_reminders_updated": "activity.action.measurement_reminders_changed",
};

/** Entity to the plain noun a sentence can use. Unknown types get the honest catch-all. */
const THING_KEYS: Readonly<Record<string, MessageKey>> = {
  patient_medication: "activity.thing.medicine",
  scheduled_dose: "activity.thing.dose",
  observation: "activity.thing.measurement",
  glucose_reading: "activity.thing.blood_sugar_reading",
  blood_pressure_reading: "activity.thing.blood_pressure_reading",
  weight_reading: "activity.thing.weight_reading",
  checkup_record: "activity.thing.checkup",
  measurement_device: "activity.thing.device",
  diagnostic_report: "activity.thing.test_report",
  diagnostic_result: "activity.thing.test_result",
  medical_report: "activity.thing.test_report",
  report_value: "activity.thing.test_result",
  prescription: "activity.thing.prescription",
  prescription_item: "activity.thing.prescription_medicine",
  prescription_document: "activity.thing.prescription",
  patient_document: "activity.thing.document",
  encounter: "activity.thing.visit",
  patient_profile: "activity.thing.profile_details",
  patient_allergy: "activity.thing.allergy",
  patient_condition: "activity.thing.condition",
  immunization: "activity.thing.vaccination",
  practitioner: "activity.thing.doctor",
  share_link: "activity.thing.share_link",
  caregiver_relationship: "activity.thing.person_with_access",
  test_due_schedule: "activity.thing.test_reminder",
  notification_preference: "activity.thing.reminder_settings",
};

function thingKey(entityType: string | null): MessageKey {
  return (entityType && THING_KEYS[entityType]) || "activity.thing.record";
}

function asEvent(item: ActivityItemDto): Pick<HealthEventDto, "kind" | "summary"> {
  return { kind: item.kind, summary: (item.summary ?? {}) as Record<string, unknown> } as Pick<HealthEventDto, "kind" | "summary">;
}

/**
 * One row, in words. HealthEvents already have a patient-facing sentence
 * (the timeline's) — reuse it rather than invent a second vocabulary for
 * the same underlying change.
 */
export function activitySentence(t: Translate, item: ActivityItemDto): string {
  if (item.source === "health_event" && item.kind) return eventSentence(t, asEvent(item));

  const action = item.action ?? "";
  const named = NAMED_ACTIONS[action];
  if (named) return t(named);

  const thing = t(thingKey(item.entityType));
  if (action.endsWith(".created")) return t("activity.verb.added", { thing });
  if (action.endsWith(".updated")) return t("activity.verb.changed", { thing });
  if (action.endsWith(".deleted") || action.endsWith(".revoked")) return t("activity.verb.removed", { thing });
  return t("activity.verb.generic");
}

/** Reuses the timeline glyphs so the same change looks the same in both places. */
export function activityGlyph(item: ActivityItemDto): EventGlyph {
  if (item.source === "health_event" && item.kind) return eventGlyph(asEvent(item));
  switch (item.entityType) {
    case "patient_medication":
    case "scheduled_dose":
      return "tablet";
    case "observation":
    case "glucose_reading":
    case "blood_pressure_reading":
    case "weight_reading":
    case "checkup_record":
      return "drop";
    case "diagnostic_report":
    case "diagnostic_result":
    case "medical_report":
    case "report_value":
      return "report";
    case "prescription":
    case "prescription_item":
    case "prescription_document":
      return "prescription";
    case "patient_document":
      return "document";
    case "encounter":
      return "hospital";
    case "share_link":
      return "share";
    case "caregiver_relationship":
    case "patient_profile":
      return "people";
    default:
      return "timeline";
  }
}

// --- the read -----------------------------------------------------------

const PAGE_LIMIT = 30;

function fetchActivityPage(cursor?: string): Promise<ActivityPageDto> {
  const query = new URLSearchParams({ limit: String(PAGE_LIMIT), ...(cursor ? { cursor } : {}) });
  return api.get<ActivityPageDto>(`/profiles/current/activity?${query.toString()}`, { profileId: getActiveProfileId() });
}

/**
 * First page through the shared cache (so a return visit renders instantly),
 * later pages appended in local state — the same split `useDocuments` uses.
 * Extra pages are deliberately not cached: they are a scroll position, not
 * a resource.
 */
export function useActivity() {
  const path = `/profiles/current/activity?limit=${PAGE_LIMIT}`;
  const first = useSharedResource<ActivityPageDto>({ path, fetcher: () => fetchActivityPage() });

  const [more, setMore] = useState<{ items: ActivityItemDto[]; nextCursor: string | null }>({ items: [], nextCursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const nextCursor = more.items.length > 0 ? more.nextCursor : (first.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchActivityPage(nextCursor);
      setMore((prev) => ({ items: [...prev.items, ...page.items], nextCursor: page.nextCursor }));
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  const seen = new Set<string>();
  const items = first.data
    ? [...first.data.items, ...more.items].filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
    : undefined;

  return { items, error: first.error, fromCache: first.fromCache, hasMore: nextCursor !== null, loadMore, loadingMore, moreError };
}
