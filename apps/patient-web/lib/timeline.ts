"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type TimelineDto, type TimelineItemDto } from "@medpass/api-client";
import { cacheTimeline, enqueueMutation, getCachedTimeline } from "@medpass/offline-sync";
import { api, getActiveProfileId } from "./api";
import { notifyMutationQueued } from "./offline";

/** Fixed +05:30 offset — matches the API's Asia/Kolkata simplification (docs/16). */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function useTimeline(date?: string) {
  const [data, setData] = useState<TimelineDto | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [fromCache, setFromCache] = useState(false);
  const effectiveDate = date ?? istToday();

  const load = useCallback(async () => {
    setError(undefined);
    const profileId = getActiveProfileId();
    try {
      const query = date ? `?date=${date}` : "";
      const res = await api.get<TimelineDto>(`/profiles/current/timeline${query}`, { profileId });
      setData(res);
      setFromCache(false);
      if (profileId) await cacheTimeline(profileId, res.date, res.items);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.problem.title);
        return;
      }
      // Not an ApiError means fetch() itself failed (no response at all) —
      // a real network outage, not a server-side rejection. Serve the cache
      // rather than a dead error screen (docs/15).
      if (profileId) {
        const cached = await getCachedTimeline<TimelineItemDto[]>(profileId, effectiveDate);
        if (cached) {
          setData({ date: effectiveDate, items: cached.items });
          setFromCache(true);
          return;
        }
      }
      setError("network");
    }
  }, [date, effectiveDate]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Applies a dose-status change to the currently-displayed timeline
   * immediately, and writes it back to the offline cache — so recording a
   * dose while offline doesn't get silently reverted the next time the
   * cache-fallback path re-renders this same data (docs/15).
   */
  const patchItem = useCallback(
    async (scheduledDoseId: string, patch: Partial<TimelineItemDto>) => {
      setData((prev) => {
        if (!prev) return prev;
        const items = prev.items.map((i) => (i.scheduledDoseId === scheduledDoseId ? { ...i, ...patch } : i));
        return { ...prev, items };
      });
      const profileId = getActiveProfileId();
      if (profileId) {
        const cached = await getCachedTimeline<TimelineItemDto[]>(profileId, effectiveDate);
        if (cached) {
          const items = cached.items.map((i) => (i.scheduledDoseId === scheduledDoseId ? { ...i, ...patch } : i));
          await cacheTimeline(profileId, effectiveDate, items);
        }
      }
    },
    [effectiveDate],
  );

  return { data, error, fromCache, reload: load, patchItem };
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
