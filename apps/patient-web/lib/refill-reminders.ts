"use client";
import type { RefillReminderDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

/** Active refill/completion reminders (docs/07 screen 27) — a Home-screen list, not just a transient push. */
export function useRefillReminders() {
  const { data, error, reload } = useSharedResource<RefillReminderDto[]>({
    path: "/profiles/current/refill-reminders",
    fetcher: async () =>
      (await api.get<{ items: RefillReminderDto[] }>("/profiles/current/refill-reminders", { profileId: getActiveProfileId() }))
        .items,
  });
  return { items: data, error, reload };
}

export async function dismissRefillReminder(notificationId: string): Promise<void> {
  await api.post(`/refill-reminders/${notificationId}/dismiss`, undefined, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/refill-reminders");
}

export async function markRefilled(patientMedicationId: string, rowVersion: number, quantityOnHand: number): Promise<void> {
  await api.post(
    `/medications/${patientMedicationId}/refill`,
    { rowVersion, quantityOnHand },
    { profileId: getActiveProfileId() },
  );
  // A refill changes quantityOnHand on the medicine itself too.
  invalidate("profile", "/profiles/current/refill-reminders");
  invalidate("profile", "/profiles/current/medications");
  invalidate("profile", "/medications/");
}
