import { expect, test } from "@playwright/test";

/**
 * The caregiver-abroad case that motivated per-profile timezones (docs/16):
 * the fixture profile lives in Asia/Kolkata; this suite views it from a
 * device set to America/Chicago and proves (1) the "times are in the
 * patient's time" banner appears with the patient's live wall clock, and
 * (2) dose times render on the patient's clock, not the viewer's.
 */
test.use({ timezoneId: "America/Chicago" });

function istTimeString(at: Date): RegExp {
  const rendered = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return new RegExp(rendered.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test("a viewer in Chicago sees the patient-time banner with the Indian wall clock", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle").catch(() => {});

  const banner = page.getByText(/Times are shown in .* time/);
  await expect(banner.first()).toBeVisible();
  // The banner's clock is the patient's, not Chicago's: allow ±1 minute of
  // drift between page render and this assertion.
  const now = new Date();
  const aMinuteAgo = new Date(now.getTime() - 60_000);
  const text = (await banner.first().textContent()) ?? "";
  // Case-insensitive: the app formats with the browser's default locale and
  // this helper with Node's, and the two can disagree on "am" vs "AM" (e.g.
  // a Windows machine whose system locale is en-IN while Chromium is en-US).
  expect(text).toMatch(new RegExp(`(${istTimeString(now).source})|(${istTimeString(aMinuteAgo).source})`, "i"));
});

test("timeline dose times render on the patient's wall clock, not the viewer's", async ({ page }) => {
  await page.goto("/timeline");
  await page.waitForLoadState("networkidle").catch(() => {});

  // The fixture medication is BD: 08:00 and 21:00 IST. In Chicago those
  // instants read 9:30/10:30 PM and AM — if either ever appears, the
  // viewer's zone leaked back in.
  const doseTimes = page.getByText(/8:00|9:00/).first();
  await expect(doseTimes).toBeVisible();
  // Only the dose rows: the "it is HH:MM there now" banner shows the real
  // wall clock, which reads 10:30 twice a day (a run at 10:30 IST hit it).
  const banner = page.getByRole("status");
  const leaked = page.getByText(/9:30|10:30/);
  const count = await leaked.count();
  for (let i = 0; i < count; i += 1) {
    const inBanner = await banner.filter({ has: leaked.nth(i) }).count();
    expect(inBanner, "a viewer-zone time leaked into a dose row").toBeGreaterThan(0);
  }
});
