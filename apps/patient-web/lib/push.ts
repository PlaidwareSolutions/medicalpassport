"use client";
import type { VapidPublicKeyDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export function pushSupported(): boolean {
  // Notification included: a browser exposing PushManager but not the
  // Notification API (seen in some headless/embedded builds) would otherwise
  // render the enable flow and then throw inside enablePush.
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Standard VAPID-key conversion — applicationServerKey must be a Uint8Array. */
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Requests permission, subscribes via the browser's push service, and
 * registers the subscription with the API. Throws with a message key on
 * every failure path so the caller can show something honest rather than a
 * silent no-op (docs/32: capability detection + explicit fallback).
 */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error("unsupported");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("permission_denied");

  const { publicKey } = await api.get<VapidPublicKeyDto>("/push/vapid-public-key");
  if (!publicKey) throw new Error("not_configured");

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));

  await api.post("/notification-channels/web-push", subscription.toJSON());
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await api.post("/notification-channels/web-push/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}

export interface NotificationPreferences {
  pushEnabled: boolean;
  privacyMode: "generic" | "full_name";
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

export async function getPreferences(): Promise<NotificationPreferences> {
  return api.get<NotificationPreferences>("/profiles/current/notification-preferences", {
    profileId: getActiveProfileId(),
  });
}

export async function savePreferences(prefs: NotificationPreferences): Promise<void> {
  await api.post("/profiles/current/notification-preferences", prefs, { profileId: getActiveProfileId() });
}
