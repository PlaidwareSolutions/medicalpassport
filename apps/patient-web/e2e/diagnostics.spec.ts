import { randomInt } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Diagnostics Phase 4 (docs_v2/06 P4-4, docs_v2/10 H-35/H-39): reports
 * seeded through the real API — two HbA1c results months apart (one with
 * a printed range), a glucose typed in mmol/L, a qualitative entry and an
 * imaging report — then the hub grouped by kind, the detail showing every
 * value as entered with the canonical twin only when the unit differs, and
 * the trend with a band, a table alternative and the unconvertible point
 * listed apart. Asserts no high/low badge anywhere for a patient-entered
 * value. Runs as its OWN user.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_API = process.env.E2E_APP_API_URL ?? process.env.E2E_API_URL ?? "http://localhost:4000";
const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const LAB_TITLE_JAN = "Diabetes panel January (dx e2e)";
const LAB_TITLE_AUG = "Diabetes panel August (dx e2e)";
const IMAGING_TITLE = "Chest X-ray PA (dx e2e)";

let ctx: APIRequestContext;
let profileId: string;
let augustReportId: string;
let imagingReportId: string;
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

/** H-25/H-30: a patient-entered value never wears a verdict badge. */
async function expectNoValueBadge(page: Page) {
  await expect(page.locator('[data-testid="dx-lab-flag"]')).toHaveCount(0);
  await expect(page.getByText(/^(High|Low|Critically high|Critically low|Abnormal|Normal)$/)).toHaveCount(0);
  await expect(page.getByText("Verified by a clinic")).toHaveCount(0);
}

test.beforeAll(async () => {
  const phone = "+9194" + String(randomInt(0, 1e8)).padStart(8, "0");
  ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { "x-requested-with": "medpass" } });

  const requested = await ctx.post("/v1/auth/otp/request", { data: { phone } });
  if (!requested.ok()) throw new Error(`otp/request failed: ${requested.status()}`);
  const verified = await ctx.post("/v1/auth/otp/verify", {
    data: { phone, code: OTP_CODE, device: { kind: "browser" }, locale: "en", rememberDevice: true },
  });
  if (!verified.ok()) throw new Error(`otp/verify failed: ${verified.status()}`);

  const profileRes = await ctx.post("/v1/profiles", { data: { displayName: "Diagnostics Test Patient", yearOfBirth: 1957, preferredLocale: "en" } });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  profileId = ((await profileRes.json()) as { id: string }).id;
  const headers = { "x-profile-id": profileId };

  async function createReport(data: Record<string, unknown>): Promise<string> {
    const res = await ctx.post("/v1/profiles/current/diagnostic-reports", { headers, data });
    if (!res.ok()) throw new Error(`report create failed: ${res.status()} ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
  }
  async function addResult(reportId: string, data: Record<string, unknown>) {
    const res = await ctx.post(`/v1/diagnostic-reports/${reportId}/results`, { headers, data });
    if (!res.ok()) throw new Error(`result create failed: ${res.status()} ${await res.text()}`);
  }

  const jan = await createReport({ kind: "laboratory", title: LAB_TITLE_JAN, testedAt: "2026-01-10T12:00:00.000Z", facilityNameText: "Sunrise Diagnostics" });
  await addResult(jan, { analyteKey: "hba1c", enteredValueText: "8.8", enteredUnit: "%", sequence: 1 });
  await addResult(jan, { analyteKey: "fasting_glucose", enteredValueText: "6.1", enteredUnit: "mmol/L", sequence: 2 });

  augustReportId = await createReport({ kind: "laboratory", title: LAB_TITLE_AUG, testedAt: "2026-08-10T12:00:00.000Z", facilityNameText: "Sunrise Diagnostics" });
  await addResult(augustReportId, { analyteKey: "hba1c", enteredValueText: "7.3", enteredUnit: "%", referenceLow: 4, referenceHigh: 5.7, sequence: 1 });

  // A qualitative entry against a numeric analyte: must land in `unconvertible`, never on the chart.
  const may = await createReport({ kind: "laboratory", title: "Sample sent (dx e2e)", testedAt: "2026-05-10T12:00:00.000Z" });
  await addResult(may, { analyteKey: "hba1c", enteredValueText: "Not done", sequence: 1 });

  imagingReportId = await createReport({
    kind: "imaging",
    title: IMAGING_TITLE,
    testedAt: "2026-07-01T12:00:00.000Z",
    modality: "xray",
    bodySite: "Chest",
    impressionText: "No active lung disease seen (dx e2e).",
    findingsText: "Lung fields are clear. Cardiac silhouette within normal limits.",
  });

  cookies = (await ctx.storageState()).cookies;
});

test.afterAll(async () => {
  await ctx?.dispose();
});

test("the trend API converts mmol/L to the canonical unit and isolates the qualitative point", async () => {
  const res = await ctx.get("/v1/profiles/current/trends/results/hba1c", { headers: { "x-profile-id": profileId } });
  expect(res.ok(), `trend: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { points: Array<{ value: number; unit: string; interpretation: string | null }>; unconvertible: Array<{ enteredValueText: string; reason: string }> };
  expect(body.points.map((p) => p.value)).toEqual([8.8, 7.3]);
  expect(body.points.every((p) => p.interpretation === null)).toBe(true);
  expect(body.unconvertible).toHaveLength(1);
  expect(body.unconvertible[0]!.enteredValueText).toBe("Not done");
  expect(body.unconvertible[0]!.reason).toBe("not_numeric");
});

test("the hub groups reports by kind", async ({ page }) => {
  await openAs(page, "/reports");
  const labs = page.getByTestId("dx-group-laboratory");
  const imaging = page.getByTestId("dx-group-imaging");
  await expect(labs).toBeVisible();
  await expect(imaging).toBeVisible();
  await expect(labs.locator('[data-testid="dx-report-card"]')).toHaveCount(3);
  await expect(imaging.locator('[data-testid="dx-report-card"]')).toHaveCount(1);
  await expect(labs).toContainText(LAB_TITLE_AUG);
  await expect(imaging).toContainText(IMAGING_TITLE);
  await expect(imaging).toContainText("X-ray");
  await expectNoValueBadge(page);
});

test("report detail shows values exactly as entered, the canonical unit alongside only when different, and no verdict", async ({ page }) => {
  await openAs(page, "/reports");
  await page.getByRole("link", { name: LAB_TITLE_JAN }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: LAB_TITLE_JAN })).toBeVisible();

  const results = page.locator('[data-testid="dx-result"]');
  await expect(results).toHaveCount(2);
  const hba1c = page.locator('[data-testid="dx-result"][data-analyte="hba1c"]');
  await expect(hba1c.getByTestId("dx-result-value")).toHaveText("8.8 %");
  // Same unit as canonical: no twin line.
  await expect(hba1c.getByText("in the usual unit")).toHaveCount(0);

  const glucose = page.locator('[data-testid="dx-result"][data-analyte="fasting_glucose"]');
  await expect(glucose.getByTestId("dx-result-value")).toHaveText("6.1 mmol/L");
  // Entered in mmol/L: the mg/dL twin is shown beside it, never instead of it (H-35).
  // Glucose is shown to the nearest whole mg/dL: 6.1 mmol/L is 110, not 109.909.
  await expect(glucose.getByText(/= 110 mg\/dL in the usual unit/)).toBeVisible();

  await expectNoValueBadge(page);
});

test("the August report shows the lab's printed range as text and links to the trend", async ({ page }) => {
  await openAs(page, `/reports/${augustReportId}`);
  const hba1c = page.locator('[data-testid="dx-result"][data-analyte="hba1c"]');
  await expect(hba1c).toContainText("Report range: 4 – 5.7");
  await expectNoValueBadge(page);
  await hba1c.getByRole("button", { name: "Over time" }).click();
  await expect(page).toHaveURL(/\/reports\/trends\/hba1c$/);
});

test("the analyte trend draws every point with the unit, a band from the printed range, a table, and the unconvertible value apart", async ({ page }) => {
  await openAs(page, "/reports/trends/hba1c");
  // The heading carries the analyte's plain-language name, not just its code.
  await expect(page.getByRole("heading", { name: /HbA1c.* over time/ })).toBeVisible();

  const chart = page.getByTestId("trend-chart");
  await expect(chart).toBeVisible();
  await expect(chart.locator('[data-testid="trend-point"]')).toHaveCount(2);
  await expect(chart.getByTestId("trend-band")).toHaveCount(1);
  await expect(chart).toContainText("Values in %");

  const table = page.getByTestId("trend-table");
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table).toContainText("8.8 %");
  await expect(table).toContainText("7.3 %");
  await expect(table).toContainText("4 – 5.7");

  const apart = page.getByTestId("trend-unconvertible");
  await expect(apart).toBeVisible();
  await expect(apart).toContainText("Not done");
  await expect(apart).toContainText("This value is a word, not a number.");

  await expectNoValueBadge(page);
});

test("an imaging report shows modality, body site, impression and findings", async ({ page }) => {
  await openAs(page, `/reports/${imagingReportId}`);
  const imaging = page.getByTestId("dx-imaging");
  await expect(imaging).toContainText("X-ray");
  await expect(imaging).toContainText("Chest");
  await expect(imaging).toContainText("No active lung disease seen (dx e2e).");
  await expect(imaging).toContainText("Lung fields are clear.");
});

test("structured entry: kind, name, an analyte with its allowed units, then the detail", async ({ page }) => {
  await openAs(page, "/reports/new");
  await page.getByRole("radio", { name: "Blood & lab tests", exact: true }).click();
  await page.getByLabel("Name of the test or report").fill("Lipid profile (dx e2e)");
  await page.getByRole("button", { name: "Add a value" }).click();
  await page.getByRole("radio", { name: /^Total Cholesterol/ }).click();
  await page.getByLabel("Value as printed").fill("182");
  // The unit picker is limited to this analyte's allowed units, canonical first.
  const canonical = page.getByRole("radio", { name: /^mg\/dL/ });
  await expect(canonical).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /^mmol\/L/ })).toBeVisible();
  await page.getByLabel("Range from (optional)").fill("125");
  await page.getByLabel("Range to (optional)").fill("200");
  await page.getByRole("button", { name: "Save report" }).click();

  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Lipid profile (dx e2e)" })).toBeVisible();
  const result = page.locator('[data-testid="dx-result"][data-analyte="total_cholesterol"]');
  await expect(result.getByTestId("dx-result-value")).toHaveText("182 mg/dL");
  await expect(result).toContainText("Report range: 125 – 200");
  await expectNoValueBadge(page);
});
