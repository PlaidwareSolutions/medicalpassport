"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthEventKind } from "@medpass/domain";
import type { MessageKey } from "@medpass/localization";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

/**
 * Health Timeline (docs_v2/05 §3, docs_v2/06 P1-4): the read model behind
 * the `/health` screen and the Home "My health" card. Events arrive newest
 * first, already projected server-side — this module only groups, labels
 * and links them. Trust badges come from `verification` and nothing else
 * (docs_v2/10 H-30): no client path may turn patient-entered data into
 * "verified" copy, and `trustBadge()` below is the single place that maps.
 */

export type ActorType = "patient" | "caregiver" | "provider" | "system";
export type ProvenanceSource =
  | "user_entered"
  | "caregiver_entered"
  | "ocr_extracted"
  | "clinic_entered"
  | "lab_imported"
  | "pharmacy_entered"
  | "device_recorded"
  | "abdm_imported"
  | "system_derived";
export type VerificationState = "unverified" | "patient_confirmed" | "provider_verified" | "source_authenticated";

export interface HealthEventDto {
  id: string;
  kind: HealthEventKind;
  /** Instant, ISO. */
  occurredAt: string;
  /** Wall-clock in the patient's zone, e.g. "2026-09-06T21:05:00" — the day-grouping key. */
  occurredAtLocal: string;
  entityType: string;
  entityId: string;
  /** Keys vary by kind — see `eventSentence`. */
  summary: Record<string, unknown>;
  encounterId: string | null;
  actorType: ActorType;
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
  supersededAt: string | null;
}

export interface HealthTimelinePageDto {
  items: HealthEventDto[];
  nextCursor: string | null;
}

export interface HealthTimelineSummaryDto {
  counts: Partial<Record<HealthEventKind, number>>;
  medicines: { active: number };
  prescriptions: number;
  tests: number;
  measurements: number;
  documents: number;
  lastEventAt: string | null;
}

// --- kind groups (the filter chips) ------------------------------------

export const KIND_GROUPS = ["medicines", "prescriptions", "tests", "measurements", "visits", "documents", "other"] as const;
export type KindGroup = (typeof KIND_GROUPS)[number];

export const KIND_GROUP_KINDS: Record<KindGroup, readonly HealthEventKind[]> = {
  medicines: [
    "medicine_started",
    "medicine_changed",
    "medicine_stopped",
    "medicine_paused",
    "medicine_resumed",
    "medicine_completed",
    "adherence_summary",
    "dispense",
    "reconciliation",
  ],
  prescriptions: ["prescription"],
  tests: ["test_result", "imaging_report"],
  measurements: ["measurement"],
  visits: ["doctor_visit", "hospital_admission", "discharge"],
  documents: ["document"],
  other: [
    "clinical_note",
    "allergy_recorded",
    "condition_recorded",
    "immunization",
    "procedure",
    "abdm_record_linked",
    "share_created",
    "caregiver_action",
    "profile_updated",
  ],
};

export function kindsForGroups(groups: readonly KindGroup[]): HealthEventKind[] {
  return groups.flatMap((g) => [...KIND_GROUP_KINDS[g]]);
}

// --- trust badge (docs_v2/10 H-30) --------------------------------------

export type TrustBadgeKey =
  | "health.trust.you_added"
  | "health.trust.caregiver_added"
  | "health.trust.not_confirmed"
  | "health.trust.clinic_verified"
  | "health.trust.from_source";

export interface TrustBadge {
  key: TrustBadgeKey;
  tone: "default" | "success" | "warning";
}

/**
 * The ONLY mapping from verification to copy. `patient_confirmed` is the
 * patient's (or caregiver's) own word and is labelled exactly that — never
 * "verified". Null verification = no badge: an event with no provenance
 * claim must not borrow one.
 */
export function trustBadge(
  event: Pick<HealthEventDto, "verification" | "actorType" | "provenanceSource">,
): TrustBadge | null {
  switch (event.verification) {
    case "patient_confirmed":
      return event.actorType === "caregiver" || event.provenanceSource === "caregiver_entered"
        ? { key: "health.trust.caregiver_added", tone: "default" }
        : { key: "health.trust.you_added", tone: "default" };
    case "unverified":
      return { key: "health.trust.not_confirmed", tone: "warning" };
    case "provider_verified":
      return { key: "health.trust.clinic_verified", tone: "success" };
    case "source_authenticated":
      return { key: "health.trust.from_source", tone: "success" };
    default:
      return null;
  }
}

// --- one-line sentence per event ---------------------------------------

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

/**
 * Builds the row's plain sentence from `summary` through localized
 * templates. Missing optional parts (no doctor named, no facility) fall
 * back to the shorter template rather than rendering "{practitioner}".
 */
export function eventSentence(t: Translate, event: Pick<HealthEventDto, "kind" | "summary">): string {
  const s = event.summary ?? {};
  switch (event.kind) {
    case "prescription": {
      const practitioner = str(s.practitionerName);
      const count = Number(s.medicineCount ?? 0);
      return practitioner
        ? t("health.event.prescription", { practitioner, count })
        : t("health.event.prescription_anon", { count });
    }
    case "medicine_started":
      return t("health.event.medicine_started", { name: str(s.name) });
    case "medicine_changed": {
      // `detail` is a string when the projection has words for the change;
      // an object ({ fields: [...] }) or a bare change code is not shown —
      // "was changed: updated" would say nothing the patient can use.
      const detail = str(s.detail);
      return detail
        ? t("health.event.medicine_changed_detail", { name: str(s.name), detail })
        : t("health.event.medicine_changed", { name: str(s.name) });
    }
    case "medicine_stopped":
      return t("health.event.medicine_stopped", { name: str(s.name) });
    case "medicine_paused":
      return t("health.event.medicine_paused", { name: str(s.name) });
    case "medicine_resumed":
      return t("health.event.medicine_resumed", { name: str(s.name) });
    case "medicine_completed":
      return t("health.event.medicine_completed", { name: str(s.name) });
    case "adherence_summary":
      return t("health.event.adherence_summary");
    case "test_result":
    case "imaging_report": {
      const label = str(s.label) || str(s.reportKind);
      const facility = str(s.facilityName);
      const base = event.kind === "test_result" ? "health.event.test_result" : "health.event.imaging_report";
      return facility ? `${t(base, { label })} · ${facility}` : t(base, { label });
    }
    case "measurement": {
      const concept = str(s.concept);
      if (concept === "blood_pressure") {
        return t("health.event.measurement_bp", { systolic: str(s.systolic), diastolic: str(s.diastolic) });
      }
      if (concept === "blood_glucose") {
        return t("health.event.measurement_glucose", { value: str(s.value), unit: str(s.unit) });
      }
      if (concept === "body_weight") {
        return t("health.event.measurement_weight", { value: str(s.value), unit: str(s.unit) });
      }
      return t("health.event.measurement_other", { value: `${str(s.value)} ${str(s.unit)}`.trim() });
    }
    case "doctor_visit":
    case "hospital_admission":
    case "discharge": {
      const key =
        event.kind === "doctor_visit"
          ? "health.event.doctor_visit"
          : event.kind === "hospital_admission"
            ? "health.event.hospital_admission"
            : "health.event.discharge";
      const parts = [str(s.practitionerName), str(s.organizationName)].filter(Boolean);
      const reason = str(s.reasonText);
      const head = parts.length > 0 ? `${t(key)} · ${parts.join(", ")}` : t(key);
      return reason ? `${head} — ${reason}` : head;
    }
    case "document":
      return t("health.event.document", { pages: Number(s.pageCount ?? 1) });
    case "clinical_note":
      return t("health.event.clinical_note");
    case "allergy_recorded":
      return t("health.event.allergy_recorded", { label: str(s.label) });
    case "condition_recorded":
      return t("health.event.condition_recorded", { label: str(s.label) });
    case "immunization": {
      const dose = s.doseNumber != null && s.doseNumber !== "" ? Number(s.doseNumber) : undefined;
      return dose
        ? t("health.event.immunization_dose", { vaccine: str(s.vaccine), dose })
        : t("health.event.immunization", { vaccine: str(s.vaccine) });
    }
    case "procedure":
      return t("health.event.procedure", { procedure: str(s.procedure) });
    case "dispense":
      return t("health.event.dispense");
    case "reconciliation":
      return t("health.event.reconciliation");
    case "abdm_record_linked":
      return t("health.event.abdm_record_linked");
    case "share_created":
      return t("health.event.share_created");
    case "caregiver_action":
      return t("health.event.caregiver_action");
    case "profile_updated":
      return t("health.event.profile_updated");
    default:
      return t("health.event.generic");
  }
}

/** Glyph per kind — hand-drawn GuideGlyph names, never emoji (docs/33). */
export type EventGlyph =
  | "tablet"
  | "prescription"
  | "report"
  | "drop"
  | "heart"
  | "scale"
  | "hospital"
  | "document"
  | "shield"
  | "pulse"
  | "syringe"
  | "cross"
  | "share"
  | "people"
  | "timeline";

export function eventGlyph(event: Pick<HealthEventDto, "kind" | "summary">): EventGlyph {
  switch (event.kind) {
    case "medicine_started":
    case "medicine_changed":
    case "medicine_stopped":
    case "medicine_paused":
    case "medicine_resumed":
    case "medicine_completed":
    case "adherence_summary":
    case "dispense":
    case "reconciliation":
      return "tablet";
    case "prescription":
      return "prescription";
    case "test_result":
    case "imaging_report":
      return "report";
    case "measurement": {
      const concept = str(event.summary?.concept);
      return concept === "blood_pressure" ? "heart" : concept === "body_weight" ? "scale" : "drop";
    }
    case "doctor_visit":
    case "hospital_admission":
    case "discharge":
      return "hospital";
    case "document":
    case "clinical_note":
    case "abdm_record_linked":
      return "document";
    case "allergy_recorded":
      return "shield";
    case "condition_recorded":
      return "pulse";
    case "immunization":
      return "syringe";
    case "procedure":
      return "cross";
    case "share_created":
      return "share";
    case "caregiver_action":
    case "profile_updated":
      return "people";
    default:
      return "timeline";
  }
}

/** Where a tap goes — the existing detail screen for the entity, or nowhere. */
export function eventHref(event: Pick<HealthEventDto, "kind" | "entityType" | "entityId" | "encounterId" | "summary">): string | null {
  switch (event.kind) {
    case "medicine_started":
    case "medicine_changed":
    case "medicine_stopped":
    case "medicine_paused":
    case "medicine_resumed":
    case "medicine_completed": {
      const id = str(event.summary?.medicationId) || event.entityId;
      return id ? `/medicines/${id}` : null;
    }
    case "prescription":
      return event.entityId ? `/prescriptions/${event.entityId}` : null;
    case "test_result":
    case "imaging_report":
      return event.entityId ? `/reports/${event.entityId}` : null;
    case "doctor_visit":
    case "hospital_admission":
    case "discharge": {
      const id = event.entityType === "encounter" ? event.entityId : (event.encounterId ?? event.entityId);
      return id ? `/health/visits/${id}` : null;
    }
    case "allergy_recorded":
      return "/allergies";
    case "condition_recorded":
      return "/conditions";
    case "immunization":
      return "/immunizations";
    case "procedure":
      return "/procedures";
    default:
      // Entity-type fallback for kinds whose entity has a screen.
      if (event.entityType === "patient_medication") return `/medicines/${event.entityId}`;
      if (event.entityType === "prescription") return `/prescriptions/${event.entityId}`;
      if (event.entityType === "medical_report") return `/reports/${event.entityId}`;
      if (event.entityType === "encounter") return `/health/visits/${event.entityId}`;
      return null;
  }
}

/** "YYYY-MM-DD" day key from the patient-local wall clock. */
export function localDayKey(event: Pick<HealthEventDto, "occurredAtLocal" | "occurredAt">): string {
  const local = event.occurredAtLocal ?? "";
  if (/^\d{4}-\d{2}-\d{2}/.test(local)) return local.slice(0, 10);
  return event.occurredAt.slice(0, 10);
}

/**
 * Whether the row should show a clock time. Calendar-dated records
 * (vaccination on a date, a procedure on a date, a prescription/report
 * dated off its paper) are projected at local noon by the server — showing
 * "12:00 PM" beside them would invent a time the patient never entered.
 */
export function showsTime(event: Pick<HealthEventDto, "kind" | "occurredAtLocal">): boolean {
  const parts = localTimeParts(event);
  if (!parts) return false;
  const dateOnlyKinds: readonly HealthEventKind[] = ["immunization", "procedure", "condition_recorded", "prescription", "test_result", "imaging_report", "document"];
  if (dateOnlyKinds.includes(event.kind) && parts.hour === 12 && parts.minute === 0) return false;
  return true;
}

/** "HH:MM" from the patient-local wall clock, or null when absent. */
export function localTimeParts(event: Pick<HealthEventDto, "occurredAtLocal">): { hour: number; minute: number } | null {
  const m = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(event.occurredAtLocal ?? "");
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

// --- data hooks ---------------------------------------------------------

export const HEALTH_TIMELINE_PATH = "/profiles/current/health-timeline";
export const PAGE_SIZE = 30;

function pagePath(kinds: readonly HealthEventKind[], cursor?: string | null): string {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_SIZE));
  if (kinds.length > 0) params.set("kinds", kinds.join(","));
  if (cursor) params.set("cursor", cursor);
  return `${HEALTH_TIMELINE_PATH}?${params.toString()}`;
}

export function fetchHealthTimelinePage(kinds: readonly HealthEventKind[], cursor?: string | null) {
  return api.get<HealthTimelinePageDto>(pagePath(kinds, cursor), { profileId: getActiveProfileId() });
}

/**
 * Cursor-paginated timeline. The first page rides the shared SWR cache so a
 * return visit renders instantly; further pages accumulate locally and are
 * dropped whenever the filter (and therefore the first-page key) changes.
 */
export function useHealthTimeline(groups: readonly KindGroup[]) {
  const kinds = kindsForGroups(groups);
  const firstPath = pagePath(kinds);
  const first = useSharedResource<HealthTimelinePageDto>({
    path: firstPath,
    fetcher: () => fetchHealthTimelinePage(kinds),
  });

  const [more, setMore] = useState<{ forPath: string; items: HealthEventDto[]; nextCursor: string | null }>({
    forPath: firstPath,
    items: [],
    nextCursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | undefined>();
  const loadingRef = useRef(false);

  // Filter change: forget the extra pages (they belong to the old query).
  useEffect(() => {
    setMore({ forPath: firstPath, items: [], nextCursor: null });
    setMoreError(undefined);
  }, [firstPath]);

  const extra = more.forPath === firstPath ? more : { forPath: firstPath, items: [], nextCursor: null };
  const nextCursor = extra.items.length > 0 ? extra.nextCursor : (first.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setMoreError(undefined);
    try {
      const page = await fetchHealthTimelinePage(kinds, nextCursor);
      setMore((prev) => {
        const base = prev.forPath === firstPath ? prev.items : [];
        return { forPath: firstPath, items: [...base, ...page.items], nextCursor: page.nextCursor };
      });
    } catch {
      setMoreError("network");
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kinds derives from firstPath
  }, [nextCursor, firstPath]);

  const items = first.data ? dedupe([...first.data.items, ...extra.items]) : undefined;

  return {
    items,
    error: first.error,
    fromCache: first.fromCache,
    reload: first.reload,
    hasMore: nextCursor !== null,
    loadMore,
    loadingMore,
    moreError,
  };
}

function dedupe(items: HealthEventDto[]): HealthEventDto[] {
  const seen = new Set<string>();
  return items.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
}

export function useHealthTimelineSummary() {
  const { data, error, reload } = useSharedResource<HealthTimelineSummaryDto>({
    path: `${HEALTH_TIMELINE_PATH}/summary`,
    fetcher: () => api.get<HealthTimelineSummaryDto>(`${HEALTH_TIMELINE_PATH}/summary`, { profileId: getActiveProfileId() }),
    // The summary is a home-card aggregate; a short TTL keeps Home from
    // re-fetching it on every tab hop while still refreshing within a minute.
    ttlMs: 60_000,
  });
  return { summary: data, error, reload };
}

/** Every clinical mutation should call this — the projection changes behind it. */
export function invalidateHealthTimeline(): void {
  invalidate("profile", HEALTH_TIMELINE_PATH);
}
