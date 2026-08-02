"use client";
import { useCallback, useEffect } from "react";
import { ApiError, type TimelineDto, type TimelineItemDto } from "@medpass/api-client";
import { cacheTimeline, enqueueMutation, getCachedTimeline, type SyncChangeSignal } from "@medpass/offline-sync";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { notifyMutationQueued, REMOTE_CHANGE_EVENT } from "./offline";

/** Fixed +05:30 offset — matches the API's Asia/Kolkata simplification (docs/16). */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function useTimeline(date?: string) {
  const effectiveDate = date ?? istToday();
  const query = date ? `?date=${date}` : "";
  const path = `/profiles/current/timeline${query}`;

  const readIndexedDb = async (): Promise<TimelineDto | undefined> => {
    const profileId = getActiveProfileId();
    if (!profileId) return undefined;
    const cached = await getCachedTimeline<TimelineItemDto[]>(profileId, effectiveDate);
    return cached ? { date: effectiveDate, items: cached.items } : undefined;
  };

  const { data, error, fromCache, reload, mutate } = useSharedResource<TimelineDto>({
    path,
    fetcher: () => api.get<TimelineDto>(path, { profileId: getActiveProfileId() }),
    seed: readIndexedDb,
    fallback: readIndexedDb,
    onFetched: async (res) => {
      const profileId = getActiveProfileId();
      if (profileId) await cacheTimeline(profileId, res.date, res.items);
    },
  });

  // A caregiver recording a dose (or this patient's own other device) while
  // this screen wasn't fetching — reload only if the changed date is the
  // one actually being viewed (docs/15 incremental sync).
  useEffect(() => {
    function onRemoteChange(e: Event) {
      const change = (e as CustomEvent<SyncChangeSignal>).detail;
      if (change.scope === "timeline" && change.profileId === getActiveProfileId() && change.dates?.includes(effectiveDate)) {
        invalidate("profile", "/profiles/current/timeline");
        void reload();
      }
    }
    window.addEventListener(REMOTE_CHANGE_EVENT, onRemoteChange);
    return () => window.removeEventListener(REMOTE_CHANGE_EVENT, onRemoteChange);
  }, [reload, effectiveDate]);

  /**
   * Applies a dose-status change to the currently-displayed timeline
   * immediately — including the shared memory entry, so navigating away and
   * back doesn't resurrect the pre-action state — and writes it back to the
   * offline cache, so recording a dose while offline doesn't get silently
   * reverted the next time the cache-fallback path re-renders (docs/15).
   */
  const patchItem = useCallback(
    async (scheduledDoseId: string, patch: Partial<TimelineItemDto>) => {
      if (data) {
        const items = data.items.map((i) => (i.scheduledDoseId === scheduledDoseId ? { ...i, ...patch } : i));
        mutate({ ...data, items });
      }
      const profileId = getActiveProfileId();
      if (profileId) {
        const cached = await getCachedTimeline<TimelineItemDto[]>(profileId, effectiveDate);
        if (cached) {
          const items = cached.items.map((i) => (i.scheduledDoseId === scheduledDoseId ? { ...i, ...patch } : i));
          await cacheTimeline(profileId, effectiveDate, items);
        }
      }
    },
    [data, mutate, effectiveDate],
  );

  return { data, error, fromCache, reload, patchItem };
}

/**
 * Records a dose action. On a genuine network failure, queues the mutation
 * for later replay (docs/15) instead of losing the patient's action — the
 * server-side idempotency key (clientMutationId) makes replay exactly-once
 * safe whenever it eventually reaches the API, even if the app is closed
 * and reopened first.
 */
export async function recordDoseEvent(
  scheduledDoseId: string,
  action: string,
  opts?: { snoozeMinutes?: number; effectiveAt?: string },
): Promise<{ status: string; queuedOffline: boolean }> {
  const profileId = getActiveProfileId();
  const clientMutationId = crypto.randomUUID();
  const payload = { action, ...opts, clientMutationId };

  try {
    const res = await api.post<{ status: string }>(`/doses/${scheduledDoseId}/events`, payload, { profileId });
    // The visible screen is patched by patchItem; this drops other cached
    // timeline dates that may embed the same dose (e.g. Home vs /timeline).
    invalidate("profile", "/profiles/current/timeline");
    return { status: res.status, queuedOffline: false };
  } catch (err) {
    if (err instanceof ApiError) throw err; // a real rejection (e.g. permission) — never hide it
    if (profileId) {
      await enqueueMutation({
        clientMutationId,
        entity: "dose_event",
        operation: "create",
        // The direct endpoint takes scheduledDoseId from the URL; the
        // generic /v1/sync dispatch (docs/15) needs it in the payload
        // itself, since a queued mutation carries no URL of its own.
        payload: { ...payload, scheduledDoseId },
        capturedAt: new Date().toISOString(),
        profileId,
      });
      notifyMutationQueued();
    }
    return { status: action === "snoozed" ? "snoozed" : action, queuedOffline: true };
  }
}
