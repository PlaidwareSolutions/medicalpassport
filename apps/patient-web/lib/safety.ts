"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type SafetyFindingDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export function useSafetyFindings() {
  const [items, setItems] = useState<SafetyFindingDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: SafetyFindingDto[] }>("/profiles/current/safety/findings", {
        profileId: getActiveProfileId(),
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, reload: load };
}

const OPEN_STATUSES = new Set(["open"]);
export function isOpenFinding(f: SafetyFindingDto): boolean {
  return OPEN_STATUSES.has(f.status);
}

export async function recordFindingAction(findingId: string, action: string, note?: string) {
  return api.post(`/findings/${findingId}/actions`, { action, note }, { profileId: getActiveProfileId() });
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
