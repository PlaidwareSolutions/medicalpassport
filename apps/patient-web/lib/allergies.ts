"use client";
import type { AllergyDto as BaseAllergyDto } from "@medpass/api-client";
import type { AllergyCategory, AllergyCriticality } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { invalidateHealthTimeline, type ProvenanceSource, type VerificationState } from "./health-timeline";

/** V1 shape plus the Phase 1 fields (docs_v2/04 §10); provenance is read-only. */
export interface AllergyDto extends BaseAllergyDto {
  category?: AllergyCategory | null;
  criticality?: AllergyCriticality | null;
  onsetDate?: string | null;
  provenanceSource?: ProvenanceSource | null;
  verification?: VerificationState | null;
}

const LIST_PATH = "/profiles/current/allergies";

export function useAllergies() {
  const { data, error, reload } = useSharedResource<AllergyDto[]>({
    path: LIST_PATH,
    fetcher: async () => (await api.get<{ items: AllergyDto[] }>(LIST_PATH, { profileId: getActiveProfileId() })).items,
  });
  return { items: data, error, reload };
}

export interface AllergyInput {
  label: string;
  severity: string;
  reactionNote?: string | null;
  category?: AllergyCategory | null;
  criticality?: AllergyCriticality | null;
  onsetDate?: string | null;
}

function bust() {
  invalidate("profile", LIST_PATH);
  // A new allergy can raise a new safety finding against current medicines.
  invalidate("profile", "/profiles/current/safety/findings");
  invalidateHealthTimeline();
}

export async function addAllergy(input: AllergyInput) {
  const res = await api.post<AllergyDto>(LIST_PATH, input, { profileId: getActiveProfileId() });
  bust();
  return res;
}

export async function updateAllergy(id: string, patch: Partial<AllergyInput> & { active?: boolean }) {
  const res = await api.patch<AllergyDto>(`/allergies/${id}`, patch, { profileId: getActiveProfileId() });
  bust();
  return res;
}

export async function deleteAllergy(id: string) {
  await api.delete(`/allergies/${id}`, { profileId: getActiveProfileId() });
  bust();
}
