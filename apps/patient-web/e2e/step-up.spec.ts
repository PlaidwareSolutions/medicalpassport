import { readFileSync, statSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page } from "@playwright/test";
import { FIXTURE_PATH, STORAGE_STATE } from "./global-setup";

/**
 * Step-up authentication (ADR-V2-012, ticket 0.20 client side): creating a
 * share is guarded, so the first attempt in a fresh session answers
 * `403 step_up_required`, the "Confirm it's you" sheet opens, and the share
 * is only created once the fixed dev OTP is verified — or not at all when
 * the patient cancels.
 *
 * Runs against the real API on the shared global-setup session. Serial and
 * in this order on purpose: after the success path the session is step-up
 * fresh for 10 minutes, so the cancel path (which needs the sheet to
 * appear) must run first.
 */
test.describe.configure({ mode: "serial" });

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
// The running Next app calls whatever NEXT_PUBLIC_API_URL it was started
// with. When the suite targets a different API instance (E2E_API_URL), the
// browser's calls are rewritten to it at the network layer — the session
// cookie is host-scoped (port-agnostic), so it follows along.
const APP_API = process.env.E2E_APP_API_URL ?? "http://localhost:4000";
const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { profileId: string };

async function routeApi(page: Page) {
  if (API === APP_API) return;
  await page
    .context()
    .route(`${APP_API}/**`, (route) => route.continue({ url: route.request().url().replace(APP_API, API) }));
  // Interception attaches to the renderer on its first navigation; against a
  // dev server (compile on first hit) the app's hydration fetches can beat
  // that attachment and escape to the original API. Warm the same-origin
  // renderer with a static, script-free URL first so the real navigation's
  // very first fetch is already rewritten.
  await page.goto("/manifest.webmanifest");
}

async function shareCount(): Promise<number> {
  const ctx = await request.newContext({
    baseURL: API,
    storageState: STORAGE_STATE,
    extraHTTPHeaders: { "x-requested-with": "medpass", "x-profile-id": fixture.profileId },
  });
  const res = await ctx.get("/v1/profiles/current/shares");
  expect(res.ok(), `shares list: ${res.status()}`).toBe(true);
  const body = (await res.json()) as { items: unknown[] };
  await ctx.dispose();
  return body.items.length;
}

// Every OTP send to a number — the global setup's login OTP included —
// starts a 30 s per-number cooldown, and opening the sheet sends. Each
// open waits out whatever remains so every test exercises a real 202 (the
// sheet copes with a 429 by counting down to Resend, but that is not the
// path under test here).
const SEND_COOLDOWN_MS = 31_000;
let lastSendAt = statSync(STORAGE_STATE).mtimeMs;

async function openSheetFromShareNew(page: Page) {
  const waitMs = SEND_COOLDOWN_MS - (Date.now() - lastSendAt);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

  await routeApi(page);
  await page.goto("/share/new");
  await page.getByRole("button", { name: "Create share" }).click();
  lastSendAt = Date.now();
  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  // Transport-accurate wording: OTP_TRANSPORT=log reads like SMS. This line
  // only renders once the API confirmed the send, so it doubles as the
  // "no 429" assertion.
  await expect(dialog.getByText("We've texted a 6-digit code to your mobile number.")).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  return dialog;
}

test.describe("cancel path @ 320px", () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test("cancelling leaves the share uncreated and says so", async ({ page }) => {
    const before = await shareCount();
    const dialog = await openSheetFromShareNew(page);

    // Reflow (docs/33): the sheet at 320px × 200% text must not widen the page.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const box = await dialog.boundingBox();
    expect(box, "dialog bounding box").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(321);
    const scrollWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    expect(scrollWidth).toBeLessThanOrEqual(321);

    // Focus landed inside the dialog (initial focus on the code field).
    await expect(dialog.getByLabel("Enter the 6-digit code")).toBeFocused();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Not confirmed — nothing was changed", { exact: false })).toBeVisible();
    // Still on the create screen, no QR result.
    await expect(page.getByRole("heading", { name: "Share your medicine list" })).toBeVisible();
    expect(await shareCount()).toBe(before);
  });

  test("Escape also cancels", async ({ page }) => {
    const dialog = await openSheetFromShareNew(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Not confirmed — nothing was changed", { exact: false })).toBeVisible();
  });
});

test("entering the code creates the share", async ({ page }) => {
  const before = await shareCount();
  const dialog = await openSheetFromShareNew(page);

  const axe = await new AxeBuilder({ page }).analyze();
  const gating = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    gating.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) })),
    "serious/critical axe violations with the step-up sheet open",
  ).toEqual([]);

  // Resend respects the 30 s cooldown right after the initial send.
  await expect(dialog.getByRole("button", { name: /Resend in \d+s/ })).toBeDisabled();

  await dialog.getByLabel("Enter the 6-digit code").fill(OTP_CODE);
  await dialog.getByRole("button", { name: "Confirm" }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Ready to share" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/\/s\/[A-Za-z0-9_-]+/)).toBeVisible();
  expect(await shareCount()).toBe(before + 1);

  // The session is now step-up fresh — a second share needs no sheet.
  const ctx = await request.newContext({ baseURL: API, storageState: STORAGE_STATE, extraHTTPHeaders: { "x-requested-with": "medpass" } });
  const session = (await (await ctx.get("/v1/auth/session")).json()) as { stepUpFresh: boolean };
  expect(session.stepUpFresh).toBe(true);
  await ctx.dispose();
});
