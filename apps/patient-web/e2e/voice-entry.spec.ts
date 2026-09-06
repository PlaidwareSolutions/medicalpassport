import { expect, test, type Page } from "@playwright/test";
import { createFreshPatient, type FreshPatient } from "./fresh-patient";

/**
 * Voice entry (docs_v2/06 P16, H-19): a spoken reading pre-fills the sheet
 * and NOTHING is saved until the patient taps Save with the numbers in
 * front of them. The browser's recognizer is replaced with a fake that
 * returns a scripted transcript, because CI has no microphone and no
 * speech service; the parser it feeds is unit-tested separately.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_API = process.env.E2E_APP_API_URL ?? process.env.E2E_API_URL ?? "http://localhost:4000";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

let patient: FreshPatient;

test.beforeAll(async () => {
  patient = await createFreshPatient("voice", "Voice Entry Patient");
});

test.afterAll(async () => {
  await patient?.dispose();
});

async function openWithFakeRecognizer(page: Page, transcript: string) {
  const cookies = (await patient.ctx.storageState()).cookies;
  await page.context().addCookies(cookies);
  await page.context().addInitScript(
    ({ id, text }) => {
      window.localStorage.setItem("medpass_locale", "en");
      window.localStorage.setItem("medpass_profile_id", id);
      // A recognizer that "hears" the scripted phrase shortly after start().
      class FakeRecognition {
        lang = "";
        interimResults = false;
        maxAlternatives = 1;
        continuous = false;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          setTimeout(() => {
            this.onresult?.({ results: [[{ transcript: text }]] });
            this.onend?.();
          }, 50);
        }
        stop() {
          this.onend?.();
        }
        abort() {}
      }
      // Chromium also exposes the unprefixed constructor; replace both so the
      // real recognizer (no microphone in CI) is never reached.
      const w = window as unknown as { SpeechRecognition: unknown; webkitSpeechRecognition: unknown };
      w.SpeechRecognition = FakeRecognition;
      w.webkitSpeechRecognition = FakeRecognition;
    },
    { id: patient.profileId, text: transcript },
  );
  if (API !== APP_API) {
    await page.context().route(`${APP_API}/**`, (route) => route.continue({ url: route.request().url().replace(APP_API, API) }));
  }
  await page.goto("/measurements/blood_pressure");
  await page.waitForLoadState("networkidle").catch(() => {});
}

test("a spoken blood pressure fills the sheet but is not saved until the patient taps Save", async ({ page }) => {
  await openWithFakeRecognizer(page, "blood pressure 128 over 76 pulse 70");
  await page.getByRole("button", { name: "Add a reading" }).click();
  const sheet = page.getByTestId("observation-sheet");

  await sheet.getByTestId("voice-entry-button").click();
  await expect(sheet.getByTestId("voice-entry-heard")).toContainText("128 over 76");
  await expect(sheet.getByLabel("Systolic — the upper number (mmHg)")).toHaveValue("128");
  await expect(sheet.getByLabel("Diastolic — the lower number (mmHg)")).toHaveValue("76");
  await expect(sheet.getByLabel("Pulse (optional)")).toHaveValue("70");
  await expect(sheet.getByText("please check every number", { exact: false })).toBeVisible();

  // Nothing reached the server yet.
  const before = await patient.ctx.get("/v1/profiles/current/observations?concept=blood_pressure", { headers: { "x-profile-id": patient.profileId } });
  expect(((await before.json()) as { items: unknown[] }).items).toHaveLength(0);

  await sheet.getByRole("button", { name: "Save reading" }).click();
  await expect(page.locator('[data-testid="observation-row"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="observation-row"]').first().getByTestId("observation-value")).toHaveText("128/76 mmHg");
});

test("speech without a readable number leaves the fields empty and says so", async ({ page }) => {
  await openWithFakeRecognizer(page, "call my daughter tomorrow");
  await page.getByRole("button", { name: "Add a reading" }).click();
  const sheet = page.getByTestId("observation-sheet");
  await sheet.getByTestId("voice-entry-button").click();
  await expect(sheet.getByText("Could not make out a reading", { exact: false })).toBeVisible();
  await expect(sheet.getByLabel("Systolic — the upper number (mmHg)")).toHaveValue("");
  await expect(sheet.getByRole("button", { name: "Save reading" })).toBeDisabled();
});
