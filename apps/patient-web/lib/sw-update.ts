"use client";
import { useEffect, useState } from "react";

/**
 * Service-worker update notification (docs/20 "app update available ·
 * service-worker update"). The Serwist config (`app/sw.ts`) sets
 * `skipWaiting`/`clientsClaim`, so a new service worker takes over
 * automatically in the background rather than waiting for the patient to
 * act — but that only updates which SW answers future network requests,
 * not the JS already loaded and running in an open tab. `controllerchange`
 * fires exactly when a new SW takes control; the very first fire (on
 * initial page load) is the SW activating for the first time, not an
 * update, so only a *subsequent* fire means a genuine update happened
 * while the page was open.
 */
export function useServiceWorkerUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let sawControllerBefore = Boolean(navigator.serviceWorker.controller);

    function onControllerChange() {
      if (sawControllerBefore) setUpdateAvailable(true);
      sawControllerBefore = true;
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Browsers only check for a new service worker periodically (roughly
    // every 24h) or on navigation by default — nudge it on every tab-focus
    // too, the same "check on visibility" pattern the sync engine already
    // uses (docs/32 fallback matrix), so an update is noticed promptly
    // rather than only after a long background interval.
    function nudgeUpdateCheck() {
      if (document.visibilityState === "visible") {
        // `update()` rejects when the registration is mid-install, being
        // replaced, or the tab is going away ("The object is in an invalid
        // state"). Nothing to do in any of those cases — the next nudge or
        // navigation checks again — so swallow it rather than let it surface
        // as an unhandled rejection on every page load in that window.
        void navigator.serviceWorker
          .getRegistration()
          .then((reg) => reg?.update())
          .catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", nudgeUpdateCheck);
    nudgeUpdateCheck();

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", nudgeUpdateCheck);
    };
  }, []);

  return {
    updateAvailable,
    reload: () => window.location.reload(),
  };
}
