"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type CaregiverAlertDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

/**
 * Persistent in-app record of missed-dose escalations (open + recently
 * corrected) — a fallback for when the push/SMS caregiver_escalation
 * notification never reached anyone. 403s silently as an empty list: a
 * caregiver without manage_reminders/full_management scope simply doesn't
 * see this section, same as any other scope-gated Home content.
 */
export function useCaregiverAlerts() {
  const [items, setItems] = useState<CaregiverAlertDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: CaregiverAlertDto[] }>("/profiles/current/caregiver-alerts", {
        profileId: getActiveProfileId(),
      });
      setItems(res.items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setItems([]);
        return;
      }
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, reload: load };
}
