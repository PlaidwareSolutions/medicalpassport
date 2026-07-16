"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type AllergyDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export function useAllergies() {
  const [items, setItems] = useState<AllergyDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: AllergyDto[] }>("/profiles/current/allergies", {
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

export async function addAllergy(input: { label: string; severity: string; reactionNote?: string }) {
  return api.post("/profiles/current/allergies", input, { profileId: getActiveProfileId() });
}
