"use client";
import { ApiClient } from "@medpass/api-client";
import { clearAllOfflineData } from "@medpass/offline-sync";

export const api = new ApiClient({
  baseUrl: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/v1`,
});

const PROFILE_STORAGE_KEY = "medpass_profile_id";

/** Active profile context (caregivers switch between profiles). Opaque ID only. */
export function getActiveProfileId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? undefined;
}

export function setActiveProfileId(id: string): void {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, id);
}

/**
 * Called on logout and on session revocation (docs/15: "Removal of local
 * data after logout where practical"). Clears the offline IndexedDB cache
 * too — a revoked session can never replay its queued mutations anyway,
 * and cached PHI (medications, timeline) must not outlive the session.
 */
export async function clearLocalState(): Promise<void> {
  window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  await clearAllOfflineData();
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
