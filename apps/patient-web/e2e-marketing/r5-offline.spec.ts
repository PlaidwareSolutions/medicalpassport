import { test, expect } from "@playwright/test";
import { hold, snap, saveRecording } from "./record.helpers";

/**
 * R5 — Offline: saved data stays viewable, a dose records offline, sync
 * resolves on reconnect. Uses context.setOffline (no DevTools UI in frame).
 * NO reminder is shown firing offline (MKT-043). The service worker needs a
 * settled first visit before going offline.
 */
test("@r5-offline records offline view + record + resync", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByText(/Due now|Nothing due right now/).first()).toBeVisible();
  // Let the service worker + IndexedDB caches settle before cutting the network.
  await page.waitForTimeout(2500);
  await page.goto("/timeline");
  await expect(page.getByText("Today's medicines").first()).toBeVisible();
  await hold(page, 800);

  await context.setOffline(true);
  await hold(page, 600);
  await snap(page, "r5-offline", "1-offline-state");

  const taken = page.getByRole("button", { name: "Taken", exact: true }).first();
  await expect(taken).toBeVisible();
  await taken.tap();
  await expect(page.getByText(/Saved on this device|Recorded|Taken/).first()).toBeVisible();
  await snap(page, "r5-offline", "2-offline-recorded");
  await hold(page, 1400);

  await context.setOffline(false);
  await expect(page.getByText(/Online|Syncing|Last synced/).first()).toBeVisible({ timeout: 20_000 });
  await snap(page, "r5-offline", "3-resynced");
  await hold(page, 1200);

  await saveRecording(page, "r5-offline");
});
