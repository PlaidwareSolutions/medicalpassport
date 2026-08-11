import { test, expect } from "@playwright/test";
import { hold, snap, saveRecording } from "./record.helpers";

/**
 * R6 — Caregiver: management screen → invitation form → bounded scopes being
 * chosen. Session 9B §0.B ruling: NO phone number is typed on camera — a
 * complete plausible number (even a synthetic one) must not be published,
 * the product does not mask the field, and painting over footage is
 * prohibited. The scopes interaction is the story anyway: granted, bounded,
 * visible.
 */
test("@r6-caregiver records invite + scopes", async ({ page }) => {
  await page.goto("/caregivers");
  await expect(page.getByText(/No caregivers yet|Invite a caregiver/).first()).toBeVisible();
  await hold(page, 1400);
  await snap(page, "r6-caregiver", "1-caregivers");

  await page.goto("/caregivers/new");
  await expect(page.getByText("Their mobile number").first()).toBeVisible();
  await hold(page, 1000);
  await snap(page, "r6-caregiver", "2-invite-form");

  const scopes = page.getByText("What can they do?").first();
  await scopes.scrollIntoViewIfNeeded();
  await expect(scopes).toBeVisible();
  await hold(page, 700);
  await page.getByText("View medicines", { exact: true }).tap();
  await hold(page, 600);
  await page.getByText("View schedule", { exact: true }).tap();
  await hold(page, 600);
  await snap(page, "r6-caregiver", "3-scopes");
  await hold(page, 1400);

  await saveRecording(page, "r6-caregiver");
});
