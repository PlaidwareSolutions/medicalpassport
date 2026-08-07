"use client";
import type { CaregiverAlertDto } from "@medpass/api-client";
import { CAREGIVER_ALERT_MAX_ITEMS } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";
import { useSharedResource } from "./data-cache";

/**
 * Recent missed-dose escalations (open + recently corrected, windowed and
 * capped server-side) — a fallback for when the push/SMS
 * caregiver_escalation notification never reached anyone. The slice only
 * re-asserts the server's cap against a stale-deployed API. 403s silently
 * as an empty list: a caregiver without manage_reminders/full_management
 * scope simply doesn't see this section, same as any other scope-gated
 * Home content.
 */
export function useCaregiverAlerts() {
  const { data, error, reload } = useSharedResource<CaregiverAlertDto[]>({
    path: "/profiles/current/caregiver-alerts",
    fetcher: async () =>
      (await api.get<{ items: CaregiverAlertDto[] }>("/profiles/current/caregiver-alerts", { profileId: getActiveProfileId() }))
        .items.slice(0, CAREGIVER_ALERT_MAX_ITEMS),
    mapApiError: (err) => (err.status === 403 ? [] : undefined),
  });
  return { items: data, error, reload };
}
