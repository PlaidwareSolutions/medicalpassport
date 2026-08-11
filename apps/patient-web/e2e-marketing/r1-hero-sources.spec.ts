import { test, expect } from "@playwright/test";
import { hold, snap, saveRecording } from "./record.helpers";

/**
 * R1 — Hero source montage (raw sources, not the final edit): home →
 * medicines → timeline → listen. Modular by design so a sharing beat can be
 * appended AFTER Stage 7 clears — no sharing/QR appears while gated.
 */
test("@r1-hero-sources records home/medicines/timeline/listen beats", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Due now|Nothing due right now|No medicines yet/).first()).toBeVisible();
  // Claim-gate guard (§25): the clinically gated findings surface must never
  // appear in marketing footage — fails the recording rather than the edit.
  await expect(page.getByText("Needs review")).toHaveCount(0);
  await hold(page, 1600);
  await snap(page, "r1-hero-sources", "1-home");

  await page.goto("/medicines");
  await expect(page.getByText(/Amlong|Glyciphage/).first()).toBeVisible();
  await hold(page, 1600);
  await snap(page, "r1-hero-sources", "2-medicines");

  await page.goto("/timeline");
  await expect(page.getByText("Today's medicines").first()).toBeVisible();
  await hold(page, 1600);
  await snap(page, "r1-hero-sources", "3-timeline");

  await page.goto("/help");
  const listen = page.getByRole("button", { name: "Listen" }).first();
  await expect(listen).toBeVisible();
  await hold(page, 600);
  await listen.tap();
  await hold(page, 2000);
  await snap(page, "r1-hero-sources", "4-listen");

  await saveRecording(page, "r1-hero-sources");
});
