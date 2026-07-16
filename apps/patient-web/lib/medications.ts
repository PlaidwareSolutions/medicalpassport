"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type PatientMedicationDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export function useMedications(status?: string) {
  const [items, setItems] = useState<PatientMedicationDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const profileId = getActiveProfileId();
      const query = status ? `?status=${status}` : "";
      const res = await api.get<{ items: PatientMedicationDto[] }>(`/profiles/current/medications${query}`, {
        profileId,
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, reload: load };
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
