import { test, expect } from "@playwright/test";
import { hold, snap, saveRecording } from "./record.helpers";

/**
 * R7 — Share with a doctor (Stage-7 CLEARED 2026-08-12). The real,
 * verified flow: patient creates a share → QR + "revoke any time" note →
 * the recipient view a doctor actually sees.
 *
 * Bearer-token safety (§6): the token is never shown as text. It lives only
 * in the QR image and — for the recipient beat — in the URL path, which
 * Playwright's video does NOT capture (no browser chrome in frame). The token
 * is read programmatically from the create response purely to navigate.
 */
test("@r7-share-doctor records create → QR → recipient summary", async ({ page }) => {
  await page.goto("/share/new");
  await expect(page.getByText("Share your medicine list").first()).toBeVisible();
  await expect(page.getByText("Needs review")).toHaveCount(0);
  await hold(page, 1600);
  await snap(page, "r7-share-doctor", "1-create-form");

  // Capture the token from the create response only to drive the recipient
  // beat; it is never rendered on screen.
  const createResponse = page.waitForResponse((r) => r.url().includes("/shares") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Create share" }).tap();
  const token = ((await (await createResponse).json()) as { token: string }).token;

  await expect(page.getByText("Ready to share").first()).toBeVisible();
  await expect(page.getByText(/revoke this share at any time/i)).toBeVisible();
  await hold(page, 2200);
  await snap(page, "r7-share-doctor", "2-qr-ready");

  // The recipient beat: what a doctor sees on their own device. No token on
  // screen (no address bar in the capture).
  await page.goto(`/s/${token}`);
  await expect(page.getByText("Shared medicine summary").first()).toBeVisible();
  await hold(page, 2600);
  await snap(page, "r7-share-doctor", "3-recipient-summary");

  await saveRecording(page, "r7-share-doctor");
});
