import { randomInt } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Measurements Phase 5 (docs_v2/06 P5-3, docs_v2/10 H-25/H-39/H-40):
 * observations seeded through the real API — BP with pulse and posture,
 * glucose with a meal context, weight, a temperature typed in °F — then
 * the hub (latest per concept with context and patient-local time), the
 * diary's add sheet with the server's plausibility refusal, the trend with
 * two BP series, a table alternative and the morning/evening split, the
 * V1 redirects, and the devices screen. Asserts no high/low badge for a
 * patient-entered reading. Runs as its OWN user.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_API = process.env.E2E_APP_API_URL ?? process.env.E2E_API_URL ?? "http://localhost:4000";
const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

let ctx: APIRequestContext;
let profileId: string;
let cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];

async function routeApi(page: Page) {
  if (API === APP_API) return;
  await page.context().route(`${APP_API}/**`, (route) => route.continue({ url: route.request().url().replace(APP_API, API) }));
  await page.goto("/manifest.webmanifest");
}

async function openAs(page: Page, path: string) {
  await page.context().addCookies(cookies);
  await page.context().addInitScript((id) => {
    window.localStorage.setItem("medpass_locale", "en");
    window.localStorage.setItem("medpass_profile_id", id);
  }, profileId);
  await routeApi(page);
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function expectNoValueBadge(page: Page) {
  await expect(page.getByText(/^(High|Low|Critically high|Critically low|Abnormal|Normal)$/)).toHaveCount(0);
  await expect(page.getByText("Verified by a clinic")).toHaveCount(0);
}

/** Instants a few days back, at a fixed Kolkata wall clock (the profile's default zone). */
function at(daysAgo: number, hourIst: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  const day = d.toISOString().slice(0, 10);
  const utcHour = hourIst - 5.5;
  const h = Math.floor(utcHour);
  const m = Math.round((utcHour - h) * 60);
  return `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
}

test.beforeAll(async () => {
  const phone = "+9193" + String(randomInt(0, 1e8)).padStart(8, "0");
  ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { "x-requested-with": "medpass" } });

  const requested = await ctx.post("/v1/auth/otp/request", { data: { phone } });
  if (!requested.ok()) throw new Error(`otp/request failed: ${requested.status()}`);
  const verified = await ctx.post("/v1/auth/otp/verify", {
    data: { phone, code: OTP_CODE, device: { kind: "browser" }, locale: "en", rememberDevice: true },
  });
  if (!verified.ok()) throw new Error(`otp/verify failed: ${verified.status()}`);

  const profileRes = await ctx.post("/v1/profiles", { data: { displayName: "Measurements Test Patient", yearOfBirth: 1959, preferredLocale: "en" } });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  profileId = ((await profileRes.json()) as { id: string }).id;
  const headers = { "x-profile-id": profileId };

  async function observe(data: Record<string, unknown>) {
    const res = await ctx.post("/v1/profiles/current/observations", { headers, data });
    if (!res.ok()) throw new Error(`observation create failed: ${res.status()} ${await res.text()}`);
  }

  // BP: morning and evening on three days, so the trend has two series and a split.
  await observe({ concept: "blood_pressure", measuredAt: at(3, 8), valueNumeric: 132, valueNumeric2: 84, pulseBpm: 74, context: "sitting" });
  await observe({ concept: "blood_pressure", measuredAt: at(3, 21), valueNumeric: 126, valueNumeric2: 80, context: "sitting" });
  await observe({ concept: "blood_pressure", measuredAt: at(2, 8), valueNumeric: 128, valueNumeric2: 82, context: "sitting" });
  await observe({ concept: "blood_pressure", measuredAt: at(1, 8), valueNumeric: 120, valueNumeric2: 80, pulseBpm: 72, context: "sitting" });
  await observe({ concept: "blood_glucose", measuredAt: at(1, 7), valueNumeric: 98, enteredUnit: "mg/dL", context: "fasting" });
  await observe({ concept: "body_weight", measuredAt: at(1, 9), valueNumeric: 72.5, enteredUnit: "kg" });
  await observe({ concept: "body_temperature", measuredAt: at(1, 20), valueNumeric: 98.6, enteredUnit: "°F", enteredValueText: "98.6" });

  cookies = (await ctx.storageState()).cookies;
});

test.afterAll(async () => {
  await ctx?.dispose();
});

test("the API stores the temperature in °C, keeps the °F entry, and never sets an interpretation for a patient entry", async () => {
  const res = await ctx.get("/v1/profiles/current/observations?concept=body_temperature", { headers: { "x-profile-id": profileId } });
  expect(res.ok(), `observations: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { items: Array<{ valueNumeric: string; unit: string; enteredUnit: string | null; interpretation: string | null; measuredAtLocal: string | null }> };
  expect(body.items).toHaveLength(1);
  expect(Number(body.items[0]!.valueNumeric)).toBeCloseTo(37, 1);
  expect(body.items[0]!.unit).toMatch(/C/);
  expect(body.items[0]!.enteredUnit).toBeTruthy();
  expect(body.items[0]!.interpretation).toBeNull();
  expect(body.items[0]!.measuredAtLocal).toMatch(/^\d{4}-\d{2}-\d{2}T20:00/);

  // The client may never set an interpretation (docs_v2/10 §1).
  const forbidden = await ctx.post("/v1/profiles/current/observations", {
    headers: { "x-profile-id": profileId },
    data: { concept: "body_weight", measuredAt: at(0, 10), valueNumeric: 70, interpretation: "high" },
  });
  expect(forbidden.status()).toBeGreaterThanOrEqual(400);
  expect(forbidden.status()).toBeLessThan(500);
});

test("the hub shows one card per concept with the latest value, context and patient-local time", async ({ page }) => {
  await openAs(page, "/measurements");
  const bp = page.getByTestId("measure-card-blood_pressure");
  await expect(bp).toContainText("120/80 mmHg");
  await expect(bp).toContainText("Sitting");
  await expect(bp).toContainText(/8:00/);
  const glucose = page.getByTestId("measure-card-blood_glucose");
  await expect(glucose).toContainText("98 mg/dL");
  await expect(glucose).toContainText("Fasting");
  await expect(page.getByTestId("measure-card-body_weight")).toContainText("72.5 kg");
  await expect(page.getByTestId("measure-card-body_temperature")).toContainText(/37 °C/);
  await expect(page.getByTestId("measure-card-spo2")).toContainText("No reading yet");
  await expectNoValueBadge(page);
});

test("the BP diary adds a reading through the sheet and surfaces the server's plausibility refusal", async ({ page }) => {
  await openAs(page, "/measurements/blood_pressure");
  await expect(page.locator('[data-testid="observation-row"]')).toHaveCount(4);

  await page.getByRole("button", { name: "Add a reading" }).click();
  const sheet = page.getByTestId("observation-sheet");
  await sheet.getByLabel("Systolic — the upper number (mmHg)").fill("999");
  await sheet.getByLabel("Diastolic — the lower number (mmHg)").fill("80");
  await sheet.getByRole("button", { name: "Save reading" }).click();
  await expect(sheet.getByRole("status")).toContainText(/between/);
  await expect(page.locator('[data-testid="observation-row"]')).toHaveCount(4);

  await sheet.getByLabel("Systolic — the upper number (mmHg)").fill("118");
  await sheet.getByLabel("Diastolic — the lower number (mmHg)").fill("78");
  await sheet.getByLabel("Pulse (optional)").fill("70");
  await sheet.getByRole("radio", { name: "Standing", exact: true }).click();
  await sheet.getByRole("button", { name: "Save reading" }).click();

  await expect(page.locator('[data-testid="observation-row"]')).toHaveCount(5);
  const newest = page.locator('[data-testid="observation-row"]').first();
  await expect(newest.getByTestId("observation-value")).toHaveText("118/78 mmHg");
  await expect(newest).toContainText("Standing");
  await expect(newest.getByText("You added this")).toBeVisible();
  await expectNoValueBadge(page);
});

test("the BP trend draws two series with a legend, a table alternative and the morning/evening split", async ({ page }) => {
  await openAs(page, "/measurements/blood_pressure/trends");
  await expect(page.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "By day" })).toHaveAttribute("aria-pressed", "true");

  const chart = page.getByTestId("trend-chart");
  await expect(chart).toBeVisible();
  await expect(chart.getByTestId("trend-series-primary")).toBeVisible();
  await expect(chart.getByTestId("trend-series-secondary")).toBeVisible();
  await expect(chart).toContainText("Values in mmHg");
  await expect(page.getByRole("list", { name: "Series" })).toContainText("Upper (systolic)");
  await expect(page.getByRole("list", { name: "Series" })).toContainText("Lower (diastolic)");

  // Three seeded days plus the bucket the diary test added today.
  const table = page.getByTestId("trend-table");
  await expect(table.locator("tbody tr")).toHaveCount(4);
  await expect(table.locator("thead")).toContainText("Morning average");
  await expect(table.locator("thead")).toContainText("Evening average");

  // Four seeded readings plus the one the diary test added; the morning /
  // evening split of that fifth depends on the wall clock the suite runs at,
  // so only the total and the presence of both halves are pinned.
  const summary = page.getByTestId("trend-summary");
  await expect(summary).toContainText("Morning average");
  await expect(summary).toContainText("Evening average");
  await expect(summary).toContainText(/\d+ readings/);
  await expect(summary.getByText("Readings", { exact: true }).locator("..")).toContainText("5");

  await page.getByRole("button", { name: "Last 7 days" }).click();
  await expect(page.getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "By week" }).click();
  await expect(page.getByTestId("trend-table")).toBeVisible();
  await expectNoValueBadge(page);
});

test("the V1 diary routes redirect to the hub concept pages", async ({ page }) => {
  await openAs(page, "/blood-sugar");
  await expect(page).toHaveURL(/\/measurements\/blood_glucose$/);
  await expect(page.getByRole("heading", { name: "Blood sugar" })).toBeVisible();
  await expect(page.locator('[data-testid="observation-row"]').first()).toContainText("98 mg/dL");
  await page.goto("/blood-pressure");
  await expect(page).toHaveURL(/\/measurements\/blood_pressure$/);
  await page.goto("/body-weight");
  await expect(page).toHaveURL(/\/measurements\/body_weight$/);
});

test("devices are recorded by hand and the screen says sync arrives later", async ({ page }) => {
  await openAs(page, "/measurements/devices");
  // Chromium with Web Bluetooth shows the "Connect" sentence instead; either way the screen explains itself.
  await expect(page.getByText(/Automatic sync .* arrives in a later release|can read a Bluetooth blood pressure monitor/)).toBeVisible();
  await page.getByRole("button", { name: "Add a device" }).click();
  await page.getByRole("radio", { name: "Blood pressure monitor", exact: true }).click();
  await page.getByLabel("A name for it (optional)").fill("Bedroom BP machine (e2e)");
  await page.getByLabel("Brand (optional)").fill("Omron");
  await page.getByRole("button", { name: "Save device" }).click();
  const row = page.locator('[data-testid="device-row"]').first();
  await expect(row).toContainText("Bedroom BP machine (e2e)");
  await expect(row).toContainText("Omron");
  await expect(row).toContainText("In use");
  await expect(row).toContainText("Readings entered by hand");
});
