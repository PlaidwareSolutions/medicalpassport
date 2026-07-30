"use client";
import { useEffect, useRef } from "react";
import { getActiveProfileId } from "./api";
import { playReminderChime } from "./chime";
import { REMOTE_CHANGE_EVENT } from "./offline";
import { getPreferences } from "./push";

/** Fixed +05:30 offset — matches the scheduling engine's Asia/Kolkata simplification (docs/16). */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface PushMessage {
  type: "medpass-push";
  payload: { profileId?: string };
}

/**
 * Mounted once (AppShell) so an already-open tab reacts the instant a push
 * arrives (docs/16: never depend only on browser push) — chimes (if the
 * profile's sound preference allows it) and reuses the existing
 * REMOTE_CHANGE_EVENT mechanism to refresh Home's due-now/missed lists,
 * with zero changes needed to useTimeline() itself.
 */
export function usePushChimeListener(): void {
  const soundEnabledRef = useRef(true);

  useEffect(() => {
    getPreferences()
      .then((prefs) => {
        soundEnabledRef.current = prefs.soundEnabled;
      })
      .catch(() => undefined); // e.g. a caregiver without manage_reminders — keep the safe default
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function onMessage(event: MessageEvent<PushMessage>) {
      if (event.data?.type !== "medpass-push") return;
      const { profileId } = event.data.payload;
      if (profileId && profileId !== getActiveProfileId()) return;

      if (soundEnabledRef.current) void playReminderChime();
      window.dispatchEvent(
        new CustomEvent(REMOTE_CHANGE_EVENT, { detail: { scope: "timeline", profileId, dates: [istToday()] } }),
      );
    }

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
}
