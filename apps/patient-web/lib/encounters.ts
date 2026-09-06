"use client";
import type { EncounterKind } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { invalidateHealthTimeline, type ProvenanceSource, type VerificationState } from "./health-timeline";

/**
 * Encounters (docs_v2/05 §2, docs_v2/04 §3.3): one visit / admission /
 * consult that ties prescriptions, reports, conditions and procedures
 * together. Provenance fields are server-stamped — never sent from here
 * (ADR-V2-002).
 */
export interface EncounterDto {
  id: string;
  kind: EncounterKind;
  startedAt: string;
  endedAt: string | null;
  organizationId: string | null;
  /** Nested form per docs_v2/05 §2; the API currently returns the flat `organizationName` — `encounterPlace()` reads either. */
  organization?: { id: string; displayName: string } | null;
  organizationName?: string | null;
  practitionerId: string | null;
  practitioner?: { id: string; displayName: string } | null;
  practitionerName?: string | null;
  reasonText: string | null;
  diagnosisText: string | null;
  notes: string | null;
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
  rowVersion?: number;
  createdAt?: string;
}

export interface EncounterDetailDto extends EncounterDto {
  prescriptions?: Array<{ id: string; practitionerName?: string | null; prescribedAt?: string | null; medicationCount?: number }>;
  medicalReports?: Array<{ id: string; kind?: string; label?: string | null; testedAt?: string | null }>;
  conditions?: Array<{ id: string; label: string; clinicalStatus?: string | null }>;
  procedures?: Array<{ id: string; procedureText: string; performedOn?: string | null }>;
}

const LIST_PATH = "/profiles/current/encounters";

export function encounterPlace(e: Pick<EncounterDto, "organization" | "organizationName">): string | null {
  return e.organization?.displayName ?? e.organizationName ?? null;
}

export function encounterDoctor(e: Pick<EncounterDto, "practitioner" | "practitionerName">): string | null {
  return e.practitioner?.displayName ?? e.practitionerName ?? null;
}

export function useEncounters() {
  const { data, error, reload, fromCache } = useSharedResource<EncounterDto[]>({
    path: LIST_PATH,
    fetcher: async () => (await api.get<{ items: EncounterDto[] }>(LIST_PATH, { profileId: getActiveProfileId() })).items,
  });
  return { items: data, error, reload, fromCache };
}

export function useEncounter(id: string) {
  const { data, error, reload } = useSharedResource<EncounterDetailDto>({
    path: `/encounters/${id}`,
    fetcher: () => api.get<EncounterDetailDto>(`/encounters/${id}`, { profileId: getActiveProfileId() }),
  });
  return { encounter: data, error, reload };
}

export interface EncounterInput {
  kind: EncounterKind;
  startedAt: string;
  endedAt?: string | null;
  organizationId?: string | null;
  practitionerId?: string | null;
  reasonText?: string | null;
  diagnosisText?: string | null;
  notes?: string | null;
}

function invalidateEncounters() {
  invalidate("profile", LIST_PATH);
  invalidate("profile", "/encounters/");
  invalidateHealthTimeline();
}

export async function createEncounter(input: EncounterInput) {
  const res = await api.post<EncounterDetailDto>(LIST_PATH, input, { profileId: getActiveProfileId() });
  invalidateEncounters();
  return res;
}

export async function updateEncounter(id: string, patch: Partial<EncounterInput> & { rowVersion?: number }) {
  const res = await api.patch<EncounterDetailDto>(`/encounters/${id}`, patch, { profileId: getActiveProfileId() });
  invalidateEncounters();
  return res;
}

export async function deleteEncounter(id: string) {
  await api.delete(`/encounters/${id}`, { profileId: getActiveProfileId() });
  invalidateEncounters();
}
