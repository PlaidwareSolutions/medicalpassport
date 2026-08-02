"use client";
import type { SafetyFindingDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export function useSafetyFindings() {
  const { data, error, reload } = useSharedResource<SafetyFindingDto[]>({
    path: "/profiles/current/safety/findings",
    fetcher: async () =>
      (await api.get<{ items: SafetyFindingDto[] }>("/profiles/current/safety/findings", { profileId: getActiveProfileId() }))
        .items,
  });
  return { items: data, error, reload };
}

const OPEN_STATUSES = new Set(["open"]);
export function isOpenFinding(f: SafetyFindingDto): boolean {
  return OPEN_STATUSES.has(f.status);
}

export async function recordFindingAction(findingId: string, action: string, note?: string) {
  const res = await api.post(`/findings/${findingId}/actions`, { action, note }, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/safety/findings");
  return res;
}

/** Fills the {medicines}/{ingredient}/{allergy}/{medicine} params from `detail`. */
export function findingExplanationParams(detail: Record<string, unknown> | null): Record<string, string> {
  if (!detail) return {};
  const names = Array.isArray(detail.medicationNames) ? (detail.medicationNames as string[]) : [];
  return {
    medicines: names.join(" + "),
    ingredient: typeof detail.ingredientName === "string" ? detail.ingredientName : "",
    allergy: typeof detail.allergyLabel === "string" ? detail.allergyLabel : "",
    medicine: typeof detail.medicationName === "string" ? detail.medicationName : "",
  };
}
