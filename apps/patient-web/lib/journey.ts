"use client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import type { ProvenanceSource, VerificationState } from "./health-timeline";

/**
 * Treatment journey (docs_v2/06 P10) — the condition hub's data layer.
 *
 * Two rules this file exists to keep true on the client side:
 *
 * 1. A suggested link is a question, never a fact. `suggestions` are the
 *    server's `status: "suggested"` edges and the screen renders them as
 *    questions with a yes/no answer; only `medicines`, `results`,
 *    `measurements` and `doctors` — all of which the server builds from
 *    stated or confirmed links — are rendered as things that are so.
 * 2. Nothing here derives a comparison. The before/after payload carries
 *    counts, averages and window bounds; this file passes them through and
 *    subtracts nothing (docs_v2/10 §1).
 */

export interface RelationshipEnd {
  type: "condition" | "medication" | "practitioner" | "analyte" | "observation_concept" | "diagnostic_result" | "observation";
  id: string | null;
  key: string | null;
  label: string | null;
}

export type RelationshipKind =
  | "medicine_for_condition"
  | "result_tracks_condition"
  | "measurement_tracks_condition"
  | "provider_for_condition"
  | "provider_for_medicine";

export interface ClinicalRelationshipDto {
  id: string;
  kind: RelationshipKind;
  status: "suggested" | "confirmed" | "dismissed";
  origin: "inferred" | "patient_stated";
  basis: string;
  from: RelationshipEnd;
  to: RelationshipEnd;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  dismissedAt: string | null;
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
}

export interface BeforeAfterWindow {
  key: "baseline" | "day30" | "day90";
  fromDay: number;
  toDay: number;
  from: string;
  to: string;
  count: number;
  average: number | null;
  min: number | null;
  max: number | null;
  average2: number | null;
  min2: number | null;
  max2: number | null;
}

export interface BeforeAfterDto {
  medication: { id: string; enteredName: string; startDate: string };
  measure: { kind: "result" | "measurement"; key: string; label: string; unit: string | null; unitDisplay: string | null };
  startDate: string;
  windows: BeforeAfterWindow[];
  hasEnoughPoints: boolean;
  minimumPointsPerWindow: number;
}

export interface TrackedMeasure {
  kind: "result" | "measurement";
  key: string;
  label: string;
  unit: string | null;
  unitDisplay: string | null;
  latest: { at: string; value: number; value2?: number | null } | null;
  points: number;
}

export interface ConditionJourneyDto {
  condition: {
    id: string;
    label: string;
    note: string | null;
    clinicalStatus: string | null;
    onsetDate: string | null;
    abatementDate: string | null;
    provenanceSource: ProvenanceSource | null;
    verification: VerificationState | null;
  };
  sections: { medicines: boolean; tests: boolean; measurements: boolean };
  medicines: Array<{
    id: string;
    enteredName: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    /** `medicine_record` — the medicine itself names this condition; `confirmed_link` — the patient said yes. */
    linkSource: "medicine_record" | "confirmed_link";
    provenanceSource: ProvenanceSource | null;
    verification: VerificationState | null;
  }>;
  results: TrackedMeasure[];
  measurements: TrackedMeasure[];
  doctors: Array<{ id: string; displayName: string; speciality: string | null; verification: string | null }>;
  suggestions: ClinicalRelationshipDto[];
  beforeAfter: BeforeAfterDto[];
}

const journeyPath = (conditionId: string) => `/profiles/current/conditions/${conditionId}/journey`;

export function useConditionJourney(conditionId: string) {
  const path = journeyPath(conditionId);
  const { data, error, fromCache, reload } = useSharedResource<ConditionJourneyDto>({
    path,
    fetcher: () => api.get<ConditionJourneyDto>(path, { profileId: getActiveProfileId() }),
  });
  return { journey: data, error, fromCache, reload };
}

/**
 * Answering a suggestion invalidates the hub and the relationship list. It
 * deliberately does not patch the cached copy in place: the answer changes
 * which medicines, results and doctors the hub is entitled to show, and
 * only the server decides that.
 */
async function answer(conditionId: string, relationshipId: string, decision: "confirm" | "dismiss") {
  await api.post(`/clinical-relationships/${relationshipId}/${decision}`, {}, { profileId: getActiveProfileId() });
  invalidate("profile", journeyPath(conditionId));
  invalidate("profile", "/profiles/current/clinical-relationships");
}

export const confirmSuggestion = (conditionId: string, relationshipId: string) => answer(conditionId, relationshipId, "confirm");
export const dismissSuggestion = (conditionId: string, relationshipId: string) => answer(conditionId, relationshipId, "dismiss");

/** Localisation key for the question a suggested edge asks. */
export function suggestionQuestionKey(kind: RelationshipKind): string {
  return `journey.question.${kind}`;
}

/** The subject of the question — the medicine, doctor, test or measurement the edge starts from. */
export function suggestionSubject(edge: ClinicalRelationshipDto): string {
  return edge.from.label ?? edge.from.key ?? "";
}

/** Trims a Prisma-ish number for display without ever rounding a clinical value away. */
export function trimNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
