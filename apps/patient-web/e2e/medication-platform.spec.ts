import { randomInt, randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Medication platform Phase 2 (docs_v2/06 P2-5): a prescription with line
 * items seeded through the real API, then the screens — the detail's
 * diagnosis/validity/follow-up and per-line "Start this medicine" (with the
 * SERVER's per-field refusal for a line with no dose, hazard H-02), the
 * medicine's why/who/since-when block linked to a condition, and the refill
 * plan projection as a plain sentence. Runs as its OWN user so the shared
 * reflow/axe fixture stays exactly as global-setup seeded it.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_API = process.env.E2E_APP_API_URL ?? process.env.E2E_API_URL ?? "http://localhost:4000";
const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const LINE_WITH_DOSE = "Amlodipine 5mg (rx e2e)";
const LINE_WITHOUT_DOSE = "Vitamin D3 sachet (rx e2e)";
const CONDITION = "High blood pressure (rx e2e)";
const DIAGNOSIS = "Essential hypertension (rx e2e)";

let ctx: APIRequestContext;
let profileId: string;
let prescriptionId: string;
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

test.beforeAll(async () => {
  const phone = "+9195" + String(randomInt(0, 1e8)).padStart(8, "0");
  ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { "x-requested-with": "medpass" } });

  const requested = await ctx.post("/v1/auth/otp/request", { data: { phone } });
  if (!requested.ok()) throw new Error(`otp/request failed: ${requested.status()}`);
  const verified = await ctx.post("/v1/auth/otp/verify", {
    data: { phone, code: OTP_CODE, device: { kind: "browser" }, locale: "en", rememberDevice: true },
  });
  if (!verified.ok()) throw new Error(`otp/verify failed: ${verified.status()}`);

  const profileRes = await ctx.post("/v1/profiles", { data: { displayName: "Rx Lines Test Patient", yearOfBirth: 1960, preferredLocale: "en" } });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  profileId = ((await profileRes.json()) as { id: string }).id;
  const headers = { "x-profile-id": profileId };

  const conditionRes = await ctx.post("/v1/profiles/current/conditions", { headers, data: { label: CONDITION, clinicalStatus: "active" } });
  if (!conditionRes.ok()) throw new Error(`condition create failed: ${conditionRes.status()} ${await conditionRes.text()}`);

  const rxRes = await ctx.post("/v1/profiles/current/prescriptions", {
    headers,
    data: {
      practitionerName: "Dr. Rx Lines",
      prescribedAt: "2026-09-01T12:00:00.000Z",
      diagnosisText: DIAGNOSIS,
      validUntil: "2026-12-01T12:00:00.000Z",
      followUpOn: "2026-10-01T12:00:00.000Z",
      items: [
        { enteredName: LINE_WITH_DOSE, sequence: 1, strengthLabel: "5 mg", doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", foodInstruction: "after" },
        { enteredName: LINE_WITHOUT_DOSE, sequence: 2 },
      ],
    },
  });
  if (!rxRes.ok()) throw new Error(`prescription create failed: ${rxRes.status()} ${await rxRes.text()}`);
  prescriptionId = ((await rxRes.json()) as { id: string }).id;

  cookies = (await ctx.storageState()).cookies;
});

test.afterAll(async () => {
  await ctx?.dispose();
});

test("the prescription API returns the lines in page order with the Phase 2 fields", async () => {
  const res = await ctx.get(`/v1/prescriptions/${prescriptionId}`, { headers: { "x-profile-id": profileId } });
  expect(res.ok(), `prescription: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { diagnosisText: string; validUntil: string; followUpOn: string; items: Array<{ enteredName: string; startedMedicationId: string | null }> };
  expect(body.diagnosisText).toBe(DIAGNOSIS);
  expect(body.validUntil).toBe("2026-12-01");
  expect(body.followUpOn).toBe("2026-10-01");
  expect(body.items.map((i) => i.enteredName)).toEqual([LINE_WITH_DOSE, LINE_WITHOUT_DOSE]);
  expect(body.items.every((i) => i.startedMedicationId === null)).toBe(true);
});

test("prescription detail shows diagnosis, validity and follow-up, and the server refuses to start a line without a dose", async ({ page }) => {
  await openAs(page, `/prescriptions/${prescriptionId}`);

  await expect(page.getByText(DIAGNOSIS)).toBeVisible();
  await expect(page.getByText("Valid until")).toBeVisible();
  await expect(page.getByText("Follow-up visit")).toBeVisible();

  const items = page.locator('[data-testid="prescription-item"]');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(LINE_WITH_DOSE);
  await expect(items.nth(1)).toContainText(LINE_WITHOUT_DOSE);
  await expect(items.nth(1)).toContainText("The dose is not written on this line yet.");

  // Line 2 has no dose: opening the sheet and confirming without choosing
  // anything must surface the API's per-field messages, not invent a dose.
  await items.nth(1).getByRole("button", { name: "Start this medicine" }).click();
  const sheet = page.getByTestId("start-medicine-sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Add to my medicines" }).click();
  await expect(sheet.getByText("choose the dose")).toBeVisible();
  await expect(sheet.getByText("Choose the medicine type")).toBeVisible();
  await expect(items.nth(1)).toHaveAttribute("data-started", "false");

  // Fill in what the paper left out, then it starts.
  await sheet.getByRole("radio", { name: "Sachet / Powder", exact: true }).click();
  await sheet.getByLabel("How much each time?").fill("1");
  await sheet.getByRole("radio", { name: "Once a day (morning)", exact: true }).click();
  await sheet.getByRole("radio", { name: "With food", exact: true }).click();
  await sheet.getByRole("button", { name: "Add to my medicines" }).click();

  await expect(page.getByText("Added to your medicines.")).toBeVisible();
  await expect(page.locator('[data-testid="prescription-item"][data-started="true"]')).toHaveCount(1);
  await expect(items.nth(1).getByText("On your list")).toBeVisible();
  await expect(items.nth(1).getByRole("button", { name: "Open the medicine" })).toBeVisible();
});

test("a line with a dose starts straight from the pre-filled sheet and links to the medicine", async ({ page }) => {
  await openAs(page, `/prescriptions/${prescriptionId}`);
  const first = page.locator('[data-testid="prescription-item"]').nth(0);
  await first.getByRole("button", { name: "Start this medicine" }).click();
  const sheet = page.getByTestId("start-medicine-sheet");
  await expect(sheet.getByRole("radio", { name: "Tablet", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.getByRole("radio", { name: "Once a day (morning)", exact: true })).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("button", { name: "Add to my medicines" }).click();
  await expect(page.locator('[data-testid="prescription-item"][data-started="true"]')).toHaveCount(2);

  await first.getByRole("button", { name: "Open the medicine" }).click();
  await expect(page).toHaveURL(/\/medicines\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: LINE_WITH_DOSE })).toBeVisible();

  // Starting again must be a 409, surfaced by the API — never a duplicate medicine.
  const res = await ctx.get(`/v1/prescriptions/${prescriptionId}`, { headers: { "x-profile-id": profileId } });
  const body = (await res.json()) as { items: Array<{ id: string; startedMedicationId: string | null }> };
  const again = await ctx.post(`/v1/prescription-items/${body.items[0]!.id}/start-medication`, {
    headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
    data: {},
  });
  expect(again.status()).toBe(409);
});

test("medicine detail links the reason to a condition and shows the refill projection as a plain sentence", async ({ page }) => {
  const res = await ctx.get(`/v1/prescriptions/${prescriptionId}`, { headers: { "x-profile-id": profileId } });
  const body = (await res.json()) as { items: Array<{ startedMedicationId: string | null }> };
  const medicationId = body.items[0]!.startedMedicationId!;
  await openAs(page, `/medicines/${medicationId}`);

  const links = page.getByTestId("medication-links");
  await expect(links).toBeVisible();
  await expect(links.getByText("No condition linked yet.")).toBeVisible();
  await links.getByRole("button", { name: "Edit these details" }).click();
  await links.getByRole("radio", { name: CONDITION }).click();
  await links.getByRole("button", { name: "Save", exact: true }).click();
  await expect(links.getByRole("link", { name: CONDITION })).toBeVisible();

  // The API now carries the link — the screen did not invent it.
  const med = await ctx.get(`/v1/medications/${medicationId}`, { headers: { "x-profile-id": profileId } });
  expect(((await med.json()) as { reasonCondition: { label: string } | null }).reasonCondition?.label).toBe(CONDITION);

  const refill = page.getByTestId("refill-plan");
  await refill.getByRole("button", { name: "Set up a refill plan" }).click();
  await refill.getByLabel(/How many .* in one pack\?/).fill("30");
  await refill.getByLabel(/How many .* do you have now\?/).fill("20");
  await refill.getByRole("button", { name: "Save refill plan" }).click();
  const projection = page.getByTestId("refill-projection");
  await expect(projection).toContainText("expected to last until");
  // A projection of the patient's own numbers — never advice to buy.
  await expect(page.getByText(/\b(buy|order|purchase)\b/i)).toHaveCount(0);

  const plan = await ctx.get(`/v1/medications/${medicationId}/refill-plan`, { headers: { "x-profile-id": profileId } });
  const planBody = (await plan.json()) as { exists: boolean; packSize: string; projectedRunOutOn: string | null };
  expect(planBody.exists).toBe(true);
  expect(Number(planBody.packSize)).toBe(30);
  expect(planBody.projectedRunOutOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("filing a new prescription with a line row lands on the detail with that line", async ({ page }) => {
  await openAs(page, "/prescriptions/new");
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Medicine name as written").fill("Paracetamol 500 (rx e2e)");
  await page.getByLabel("Diagnosis written on the prescription (optional)").fill("Fever (rx e2e)");
  await page.getByRole("button", { name: "Save prescription" }).click();

  await expect(page).toHaveURL(/\/prescriptions\/[0-9a-f-]{36}$/);
  await expect(page.locator('[data-testid="prescription-item"]')).toHaveCount(1);
  await expect(page.getByText("Paracetamol 500 (rx e2e)")).toBeVisible();
  await expect(page.getByText("Fever (rx e2e)")).toBeVisible();
});
