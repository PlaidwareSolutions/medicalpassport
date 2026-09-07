import { expect, test } from "@playwright/test";

/**
 * The three QA findings a browser is the only witness to: a label that
 * breaks mid-word at a real phone width, a route that existed but had no
 * door, and a first-run form that re-rendered for an account past first run.
 *
 * Everything else that pass found — display rounding, plural forms, English
 * leaking into hi/te/ur, axis labels, the not-relevant outcome — is pure
 * enough to assert in lib/observations.test.ts and lib/patient-copy.test.ts,
 * and is not repeated here.
 */

test.describe("Home tiles at a real phone width", () => {
  // 390px is the iPhone 12/13/14 logical width — the narrowest mainstream
  // phone, and where QA saw "Measurement / s".
  test.use({ viewport: { width: 390, height: 844 } });

  test("no tile label is broken in the middle of a word", async ({ page }) => {
    await page.goto("/");
    const card = page.getByTestId("my-health-card");
    await expect(card).toBeVisible();

    const tiles = card.locator('[data-testid^="home-tile-"]');
    await expect(tiles.first()).toBeVisible();

    for (const tile of await tiles.all()) {
      const label = tile.locator("strong").first();
      const text = (await label.innerText()).trim();
      // A single word must occupy a single line. Comparing the rendered
      // height against one line's height catches a mid-word break without
      // hard-coding any pixel value or font metric.
      const lines = await label.evaluate((el) => {
        const style = getComputedStyle(el);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
        return Math.round(el.getBoundingClientRect().height / lineHeight);
      });
      const words = text.split(/\s+/).filter(Boolean).length;
      expect(lines, `"${text}" wrapped onto ${lines} lines from ${words} word(s)`).toBeLessThanOrEqual(words);
    }
  });
});

test("Profile offers a way to the share list, distinct from clinic access", async ({ page }) => {
  await page.goto("/profile");

  const shareRow = page.locator('a[href="/share"]').first();
  await expect(shareRow).toBeVisible();
  const connectionsRow = page.locator('a[href="/connections"]').first();
  await expect(connectionsRow).toBeVisible();

  // Two neighbouring rows that are easy to confuse: each has to say which
  // it is, or the row is no better than the missing route was.
  const shareText = (await shareRow.innerText()).toLowerCase();
  const connectionsText = (await connectionsRow.innerText()).toLowerCase();
  expect(shareText).toContain("link");
  expect(connectionsText).toContain("clinic");
  expect(shareText).not.toBe(connectionsText);

  await shareRow.click();
  await expect(page).toHaveURL(/\/share$/);
});

test("/onboarding/profile does not offer a second first-run profile to a signed-in patient", async ({ page }) => {
  await page.goto("/onboarding/profile");

  // The account already has a profile, so this screen has nothing to ask.
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  await expect(page.getByRole("heading", { name: /tell us about yourself/i })).toHaveCount(0);
  await expect(page.getByTestId("my-health-card")).toBeVisible();
});
