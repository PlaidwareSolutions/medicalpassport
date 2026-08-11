import { test, expect } from "@playwright/test";
import { hold, snap, saveRecording } from "./record.helpers";

/**
 * R4 — Listen/read-aloud (Session 8 proof: ENGLISH ONLY; hi/te/ur final
 * marketing recordings stay gated on professional language review — the
 * framework is locale-capable via Playwright locale/localStorage but no
 * non-English recording is generated). Verifies the control genuinely
 * changes state (Listen → Stop) — no permission prompts, no fake captions.
 */
test("@r4-listen records the read-aloud interaction (en)", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByRole("button", { name: "Listen" }).first()).toBeVisible();
  await hold(page, 1000);
  await snap(page, "r4-listen", "1-before");

  await page.getByRole("button", { name: "Listen" }).first().tap();
  await expect(page.getByRole("button", { name: "Stop" }).first()).toBeVisible();
  await snap(page, "r4-listen", "2-playing");
  await hold(page, 2600);
  const stop = page.getByRole("button", { name: "Stop" }).first();
  if (await stop.isVisible().catch(() => false)) await stop.tap();
  await hold(page, 800);

  await saveRecording(page, "r4-listen");
});
