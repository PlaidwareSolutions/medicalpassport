/// <reference lib="webworker" />
/**
 * Service worker (docs/12 PWA architecture):
 * - precaches the versioned app shell
 * - NEVER caches API responses — PHI is excluded from SW caches by rule;
 *   offline PHI lives only in IndexedDB under the sync contract (docs/15)
 * - serves /offline as the navigation fallback
 */
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // API traffic (any origin, /v1/ or /healthz paths) is network-only.
      matcher: ({ url }) => url.pathname.startsWith("/v1/") || url.pathname === "/readyz" || url.pathname === "/healthz",
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/**
 * Web push (docs/16). The payload never carries a medication name unless
 * the patient opted into `full_name` wording (docs/09 §6 privacy default) —
 * that choice is made server-side when the notification is built, not here.
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json() as PushPayload;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
