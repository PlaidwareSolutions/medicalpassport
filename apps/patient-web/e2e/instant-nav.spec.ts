import { expect, test, type Page } from "@playwright/test";

/**
 * The stale-while-revalidate data layer (lib/data-cache.ts): repeat
 * navigation must render from the session cache instantly instead of
 * spinning until the network answers, without giving up freshness (every
 * mount still revalidates) or the docs/15 offline behavior.
 *
 * Navigations here are CLIENT-SIDE (bottom-nav clicks), deliberately: a full
 * page.goto reloads the JS context and empties the in-memory cache, which is
 * exactly what these tests must not do between steps.
 */

// Service workers are blocked so page.route sees every request — the SW only
// caches static assets, but interception order would stop being deterministic.
test.use({ serviceWorkers: "block" });

async function navTo(page: Page, label: string) {
  await page.getByRole("link", { name: label, exact: true }).click();
}

test("repeat navigation renders from cache while the network is still answering", async ({ page }) => {
  // Cold visit to warm the cache: Home, then Medicines.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Medicines" })).toBeVisible();
  await navTo(page, "Medicines");
  await expect(page.getByText("Metformin Hydrochloride Extended Release 500mg")).toBeVisible();
  await navTo(page, "Home");
  await expect(page.getByRole("link", { name: "Medicines" })).toBeVisible();

  // Delay every subsequent API response well past the assertion timeouts. If
  // the UI still renders the list, it rendered from the cache — not the
  // network. (continue() may race test teardown once the delay elapses —
  // that's fine, the assertions have long finished.)
  await page.route("**/v1/**", async (route) => {
    if (route.request().method() === "GET") {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
    }
    await route.continue().catch(() => {});
  });

  await navTo(page, "Medicines");
  // The medicines screen's own chrome plus a tile rendered from cache — the
  // name also exists on Home (dose cards), so scope to the tile link.
  await expect(page.getByRole("tab", { name: "Previous medicines" })).toBeVisible({ timeout: 3_000 });
  await expect(
    page.locator('a[href^="/medicines/"]').getByText("Metformin Hydrochloride Extended Release 500mg").first(),
  ).toBeVisible({ timeout: 3_000 });
  // The loading spinner must not be what greeted the patient.
  await expect(page.getByRole("status").filter({ hasText: "Loading" })).toHaveCount(0);
});

test("the medicines screen issues one list request, not two", async ({ page }) => {
  const medicationGets: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "GET" && req.url().includes("/v1/profiles/current/medications")) {
      medicationGets.push(new URL(req.url()).search);
    }
  });

  await page.goto("/medicines");
  await expect(page.getByText("Metformin Hydrochloride Extended Release 500mg")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});

  // Unfiltered requests only — the "current" tab is derived client-side, so
  // the old second `?status=current` request must be gone. (The unfiltered
  // one can legitimately fire more than once on a cold load: the sync
  // engine's remote-change signal triggers a reload, same as before.)
  expect(medicationGets.filter((search) => search.includes("status"))).toEqual([]);
  expect(medicationGets.length).toBeGreaterThan(0);

  // And the tab switch costs nothing.
  const before = medicationGets.length;
  await page.getByRole("tab", { name: "Previous medicines" }).click();
  await page.getByRole("tab", { name: "Current medicines" }).click();
  expect(medicationGets.length).toBe(before);
});

test("invitation checks stop repeating on every navigation", async ({ page }) => {
  let invitationGets = 0;
  page.on("request", (req) => {
    if (
      req.method() === "GET" &&
      (req.url().includes("/v1/caregivers/invitations") || req.url().includes("/v1/profiles/claim-invitations"))
    ) {
      invitationGets += 1;
    }
  });

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Medicines" })).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  const afterFirstLoad = invitationGets;
  expect(afterFirstLoad).toBeGreaterThan(0); // the cold mount genuinely checks

  // Three more screens inside the 60s TTL: no further invitation traffic.
  await navTo(page, "Medicines");
  await navTo(page, "Safety");
  await navTo(page, "Home");
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(invitationGets).toBe(afterFirstLoad);
});

test("warm data still renders when the network goes away entirely", async ({ page, context }) => {
  // Warm the medicines cache online.
  await page.goto("/medicines");
  await expect(page.getByText("Metformin Hydrochloride Extended Release 500mg")).toBeVisible();
  await navTo(page, "Home");
  await expect(page.getByRole("link", { name: "Medicines" })).toBeVisible();

  await context.setOffline(true);
  await navTo(page, "Medicines");
  // docs/15: cached content rather than a dead error screen.
  await expect(page.getByText("Metformin Hydrochloride Extended Release 500mg")).toBeVisible({ timeout: 5_000 });
  await context.setOffline(false);
});
