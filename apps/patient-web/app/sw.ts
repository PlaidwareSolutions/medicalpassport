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
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist } from "serwist";
import { putSharedFiles } from "../lib/share-target-inbox";

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
    {
      // Pre-generated guidance audio (static UI copy, not PHI): the files
      // are content-addressed so CacheFirst can never serve stale audio.
      // maxEntries ≈ one locale's full set — the patient plays one locale,
      // and docs/01 P4's phone has almost no free storage; deliberately not
      // precached (see globPublicPatterns in next.config.mjs).
      matcher: ({ url }) => url.pathname.startsWith("/audio/guidance/"),
      handler: new CacheFirst({
        cacheName: "guidance-audio",
        plugins: [new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 90 })],
      }),
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

/**
 * Web Share Target (docs_v2/09 §3, docs_v2/10 H-38). The manifest's
 * `share_target` POSTs the shared files here as multipart form data. They
 * are parked in IndexedDB (never a SW cache — PHI, docs/15) and the browser
 * is redirected to the `/share-target` screen, which asks which profile
 * they belong to before anything is uploaded. Registered BEFORE Serwist's
 * own listeners so this POST is answered here and never reaches any
 * caching strategy: nothing about a share is ever cached, and a failure
 * still lands on the screen with an honest error rather than a blank tab.
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/share-target") return;
  event.respondWith(
    (async () => {
      try {
        const formData = await event.request.formData();
        const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
        await putSharedFiles(files);
        return Response.redirect("/share-target?received=1", 303);
      } catch {
        return Response.redirect("/share-target?error=1", 303);
      }
    })(),
  );
});

serwist.addEventListeners();

interface PushPayload {
  title: string;
  body: string;
  url: string;
  silent?: boolean;
  vibrate?: number[];
  requireInteraction?: boolean;
  tag?: string;
  renotify?: boolean;
  profileId?: string;
}

/**
 * Web push (docs/16). The payload never carries a medication name unless
 * the patient opted into `full_name` wording (docs/09 §6 privacy default) —
 * that choice is made server-side when the notification is built, not here.
 * Patient-facing reminders additionally carry vibration/persistence/sound
 * hints (undefined for caregiver_escalation/dose_correction — today's exact
 * plain display, unchanged).
 */
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json() as PushPayload;
  event.waitUntil(
    (async () => {
      // `vibrate`/`renotify` are part of the real Notification API spec but
      // missing from TypeScript's bundled NotificationOptions type here —
      // widened locally.
      const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
        body: payload.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: payload.url },
        silent: payload.silent,
        vibrate: payload.vibrate,
        requireInteraction: payload.requireInteraction,
        tag: payload.tag,
        renotify: payload.renotify,
      };
      await self.registration.showNotification(payload.title, options);
      // Lets an already-open tab react in real time (in-app chime, instant
      // Home-screen refresh) — the OS notification above is the reliable
      // channel regardless; this is a same-timing bonus, not a replacement.
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) client.postMessage({ type: "medpass-push", payload });
    })(),
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
