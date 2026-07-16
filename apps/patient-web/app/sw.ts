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
