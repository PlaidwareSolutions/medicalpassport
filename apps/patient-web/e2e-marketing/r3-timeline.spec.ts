import { test, expect } from "@playwright/test";
import { hold, snap, saveRecording } from "./record.helpers";

/**
 * R3 — Today's timeline: reached the way a patient reaches it (Home →
 * "View today's full schedule"), which also avoids the cold-load "Loading…"
 * flash a direct navigation records. Shows slots, one supported "Taken"
 * action, and the recorded state.
 */
test("@r3-timeline records the timeline and a taken dose", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Due now|Nothing due right now/).first()).toBeVisible();
  await expect(page.getByText("Needs review")).toHaveCount(0);
  await hold(page, 1200);

  await page.getByText("View today's full schedule").tap();
  await expect(page.getByText("Today's medicines").first()).toBeVisible();
  await hold(page, 2000);
  await snap(page, "r3-timeline", "1-timeline");

  const taken = page.getByRole("button", { name: "Taken", exact: true }).first();
  await expect(taken).toBeVisible();
  await hold(page, 800);
  await taken.tap();
  await expect(page.getByText(/Recorded|Taken/).first()).toBeVisible();
  await snap(page, "r3-timeline", "2-recorded");
  await hold(page, 2200);

  await saveRecording(page, "r3-timeline");
});
