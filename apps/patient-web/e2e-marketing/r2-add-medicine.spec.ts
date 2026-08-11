import { test, expect } from "@playwright/test";
import { hold, snap, saveRecording } from "./record.helpers";

/**
 * R2 — Add medicine (the Session 8 proof flow). Search → select → review the
 * typing-free pickers → save → the medicine appears in the passport. Uses
 * Dolo 650 as an SOS ("only when needed") medicine so the seeded timeline
 * slots stay deterministic for R1/R3. The patient's review/confirm step is
 * the point of the footage — no staged "AI magic".
 */
test("@r2-add-medicine records the search→confirm→saved flow", async ({ page }) => {
  await page.goto("/add");
  await expect(page.getByText("Add a medicine").first()).toBeVisible();
  await hold(page);

  const search = page.getByPlaceholder("e.g. Dolo, Metformin");
  await search.tap();
  await search.pressSequentially("Dolo", { delay: 140 });
  const result = page.getByText("Dolo 650", { exact: false }).first();
  await expect(result).toBeVisible();
  await hold(page, 600);
  await snap(page, "r2-add-medicine", "1-search-results");
  await result.tap();

  await expect(page.getByRole("group", { name: "How often?" })).toBeVisible();
  await hold(page, 600);
  await page.getByRole("group", { name: "How often?" }).getByText("Only when needed").tap();
  await hold(page, 400);
  const reason = page.getByLabel("What did the doctor say it is for? (optional)");
  if (await reason.isVisible().catch(() => false)) {
    await reason.tap();
    await reason.pressSequentially("Fever", { delay: 120 });
  }
  await snap(page, "r2-add-medicine", "2-review-before-save");
  await hold(page, 600);

  await page.getByRole("button", { name: "Save medicine" }).tap();
  await page.waitForURL(/\/medicines/, { timeout: 15_000 });
  await expect(page.getByText("Dolo 650", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await snap(page, "r2-add-medicine", "3-saved-in-passport");
  await hold(page, 1200);

  await saveRecording(page, "r2-add-medicine");
});
