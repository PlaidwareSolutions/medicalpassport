import { expect, test } from "@playwright/test";

// Never fails — prints the browser's capability surface into the run log so
// an environment-dependent failure (like a headless build missing an API)
// is diagnosed from facts, not theories.
test("environment probe (diagnostic)", async ({ page }) => {
  await page.goto("/");
  console.log(
    "env-probe:",
    await page.evaluate(() =>
      JSON.stringify({
        notification: typeof Notification,
        notificationPermission: typeof Notification !== "undefined" ? Notification.permission : null,
        pushManager: "PushManager" in window,
        serviceWorker: "serviceWorker" in navigator,
        userAgent: navigator.userAgent,
      }),
    ),
  );
});

/**
 * Screens 37/38 (docs/07): the OS notification prompt may only ever fire
 * after the in-app explainer's Continue, and add-to-home-screen education is
 * an offer that dismisses forever. `Notification.requestPermission` is
 * wrapped with a counter before any app code runs, so the ordering is
 * proven, not assumed. English locale only — the flow is locale-independent
 * and the guidance suite already sweeps localization.
 */

test.describe("notification permission education", () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      const w = window as unknown as { __permissionPrompts: number; Notification?: unknown };
      w.__permissionPrompts = 0;
      if ("Notification" in window) {
        const original = Notification.requestPermission.bind(Notification);
        Notification.requestPermission = () => {
          w.__permissionPrompts += 1;
          return original();
        };
      } else {
        // Some headless builds ship PushManager without Notification; stub a
        // deterministic one so the education flow renders and the counter
        // still proves prompt ordering.
        w.Notification = {
          permission: "default",
          requestPermission: () => {
            w.__permissionPrompts += 1;
            return Promise.resolve("denied");
          },
        };
      }
    });
  });

  test("the OS prompt fires only after Continue", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Turn on reminders", exact: true }).click();

    // Education interstitial visible, no OS prompt yet.
    await expect(page.getByText("Turn on medicine reminders?")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __permissionPrompts: number }).__permissionPrompts)).toBe(0);

    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __permissionPrompts: number }).__permissionPrompts)).toBe(1);
  });

  test("Not now backs out without any prompt", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: "Turn on reminders", exact: true }).click();
    await expect(page.getByText("Turn on medicine reminders?")).toBeVisible();
    await page.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(page.getByText("Turn on medicine reminders?")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __permissionPrompts: number }).__permissionPrompts)).toBe(0);
  });
});

test.describe("first-run tour", () => {
  test("continue walks all three cards to Home; skip exits immediately", async ({ page }) => {
    await page.goto("/tour");
    await expect(page.getByRole("heading", { name: "Your medicines, in one place" })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "We remind you on time" })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Show it to any doctor" })).toBeVisible();
    await page.getByRole("button", { name: "Let's begin", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/tour");
    await page.getByRole("button", { name: "Skip for now", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("help screen", () => {
  // A fresh, signed-out context: help must be reachable before any login
  // (docs/07 shared defaults exempt it from auth).
  test.use({ storageState: { cookies: [], origins: [] } });

  test("public, answers always visible, emergency boundary present, tour replay works", async ({ page }) => {
    await page.goto("/help");
    await expect(page.getByRole("heading", { name: "Help" })).toBeVisible();

    // Answers are permanently expanded — visible without any interaction.
    await expect(page.getByText("Which medicines am I taking now?")).toBeVisible();
    await expect(page.getByText("Open Medicines from the bottom bar", { exact: false })).toBeVisible();

    await expect(page.getByText("Call 112 or your doctor right away", { exact: false })).toBeVisible();

    await page.getByText("See how the app works again").click();
    await expect(page.getByRole("heading", { name: "Your medicines, in one place" })).toBeVisible();
  });
});

test.describe("install education", () => {
  test.beforeEach(async ({ context }) => {
    // Headless Chromium never fires beforeinstallprompt on its own —
    // synthesize one. Re-fire for a few seconds because on a slow runner the
    // app bundle (whose module scope registers the capture listener) can
    // evaluate AFTER window.load; a single dispatch then vanishes unheard.
    // Real Chrome has no such race: its genuine event fires from browser
    // heuristics well after the page settles.
    await context.addInitScript(() => {
      const fire = () => {
        const event = new Event("beforeinstallprompt") as Event & {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        };
        event.prompt = () => Promise.resolve();
        event.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(event);
      };
      window.addEventListener("load", () => {
        fire();
        const interval = setInterval(fire, 500);
        setTimeout(() => clearInterval(interval), 8000);
      });
    });
  });

  test("card shows on Home with medicines, and No thanks dismisses forever", async ({ page }) => {
    await page.goto("/");
    // Generous timeout: the synthetic prompt may land on a later re-fire.
    await expect(page.getByText("Put this app on your home screen")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "No thanks", exact: true }).click();
    await expect(page.getByText("Put this app on your home screen")).toHaveCount(0);

    // Dismissal persists across a reload.
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByText("Put this app on your home screen")).toHaveCount(0);
  });
});
