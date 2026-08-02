"use client";
import type { AllergyDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export function useAllergies() {
  const { data, error, reload } = useSharedResource<AllergyDto[]>({
    path: "/profiles/current/allergies",
    fetcher: async () =>
      (await api.get<{ items: AllergyDto[] }>("/profiles/current/allergies", { profileId: getActiveProfileId() })).items,
  });
  return { items: data, error, reload };
}

export async function addAllergy(input: { label: string; severity: string; reactionNote?: string }) {
  const res = await api.post("/profiles/current/allergies", input, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/allergies");
  // A new allergy can raise a new safety finding against current medicines.
  invalidate("profile", "/profiles/current/safety/findings");
  return res;
}
