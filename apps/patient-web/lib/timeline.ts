"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type TimelineDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export function useTimeline(date?: string) {
  const [data, setData] = useState<TimelineDto | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const query = date ? `?date=${date}` : "";
      const res = await api.get<TimelineDto>(`/profiles/current/timeline${query}`, {
        profileId: getActiveProfileId(),
      });
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, reload: load };
}

export async function recordDoseEvent(
  scheduledDoseId: string,
  action: string,
  opts?: { snoozeMinutes?: number; effectiveAt?: string },
) {
  return api.post(
    `/doses/${scheduledDoseId}/events`,
    { action, ...opts, clientMutationId: crypto.randomUUID() },
    { profileId: getActiveProfileId() },
  );
}
