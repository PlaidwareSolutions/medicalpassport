"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type PatientMedicationDto } from "@medpass/api-client";
import { cacheMedications, getCachedMedications } from "@medpass/offline-sync";
import { api, getActiveProfileId } from "./api";

export function useMedications(status?: string) {
  const [items, setItems] = useState<PatientMedicationDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [fromCache, setFromCache] = useState(false);
  const variant = status ?? "all";

  const load = useCallback(async () => {
    setError(undefined);
    const profileId = getActiveProfileId();
    try {
      const query = status ? `?status=${status}` : "";
      const res = await api.get<{ items: PatientMedicationDto[] }>(`/profiles/current/medications${query}`, {
        profileId,
      });
      setItems(res.items);
      setFromCache(false);
      if (profileId) await cacheMedications(profileId, variant, res.items);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.problem.title);
        return;
      }
      // Genuine network failure (no response at all) — fall back to cache
      // rather than a dead error screen (docs/15).
      if (profileId) {
        const cached = await getCachedMedications<PatientMedicationDto[]>(profileId, variant);
        if (cached) {
          setItems(cached.items);
          setFromCache(true);
          return;
        }
      }
      setError("network");
    }
  }, [status, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, fromCache, reload: load };
}

export function instructionSummary(
  m: PatientMedicationDto,
  t: (key: never, params?: Record<string, string | number>) => string,
): string {
  const i = m.instruction;
  if (!i) return "";
  const freq = t(`frequency.${i.frequencyCode.toLowerCase()}` as never);
  const food = t(`food.${i.foodInstruction}` as never);
  const pattern = i.pattern ? ` ${i.pattern}` : "";
  return `${i.doseQuantity} ${i.doseUnit} · ${freq}${pattern} · ${food}`;
}
