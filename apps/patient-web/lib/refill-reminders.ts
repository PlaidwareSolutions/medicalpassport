"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type RefillReminderDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

/** Active refill/completion reminders (docs/07 screen 27) — a Home-screen list, not just a transient push. */
export function useRefillReminders() {
  const [items, setItems] = useState<RefillReminderDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: RefillReminderDto[] }>("/profiles/current/refill-reminders", {
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

export async function dismissRefillReminder(notificationId: string): Promise<void> {
  await api.post(`/refill-reminders/${notificationId}/dismiss`, undefined, { profileId: getActiveProfileId() });
}

export async function markRefilled(patientMedicationId: string, rowVersion: number, quantityOnHand: number): Promise<void> {
  await api.post(
    `/medications/${patientMedicationId}/refill`,
    { rowVersion, quantityOnHand },
    { profileId: getActiveProfileId() },
  );
}
