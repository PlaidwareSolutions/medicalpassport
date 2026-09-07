import { randomInt, randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Health Timeline (docs_v2/06 P1-4, docs_v2/10 H-30): seeds through the
 * real API — a medicine, a change to it, and an allergy — then proves the
 * timeline shows both with the patient's-own-word badge (never "verified"),
 * that the kind-group chips filter, and that a recorded visit appears as
 * one. Runs as its OWN user so the shared reflow/axe fixture stays exactly
 * as global-setup seeded it.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_API = process.env.E2E_APP_API_URL ?? process.env.E2E_API_URL ?? "http://localhost:4000";
const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const MEDICINE = "Amlodipine Besylate 5mg (timeline e2e)";
const ALLERGY = "Sulfa drugs (timeline e2e)";

let ctx: APIRequestContext;
let profileId: string;
let medicationId: string;
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
  const phone = "+9196" + String(randomInt(0, 1e8)).padStart(8, "0");
  ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { "x-requested-with": "medpass" } });

  const requested = await ctx.post("/v1/auth/otp/request", { data: { phone } });
  if (!requested.ok()) throw new Error(`otp/request failed: ${requested.status()}`);
  const verified = await ctx.post("/v1/auth/otp/verify", {
    data: { phone, code: OTP_CODE, device: { kind: "browser" }, locale: "en", rememberDevice: true },
  });
  if (!verified.ok()) throw new Error(`otp/verify failed: ${verified.status()}`);

  const profileRes = await ctx.post("/v1/profiles", {
    data: { displayName: "Timeline Test Patient", yearOfBirth: 1958, preferredLocale: "en" },
  });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  profileId = ((await profileRes.json()) as { id: string }).id;
  const headers = { "x-profile-id": profileId };

  // 1. A medicine, then a change to it (dose 1 → 2 tablets) — two timeline events.
  const medRes = await ctx.post("/v1/profiles/current/medications", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      enteredName: MEDICINE,
      source: "manual",
      instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-0-0", foodInstruction: "after" },
    },
  });
  if (!medRes.ok()) throw new Error(`medication create failed: ${medRes.status()} ${await medRes.text()}`);
  const med = (await medRes.json()) as { id: string; rowVersion: number };
  medicationId = med.id;
  const changeRes = await ctx.patch(`/v1/medications/${med.id}`, {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { rowVersion: med.rowVersion, instruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-0-0", foodInstruction: "after" } },
  });
  if (!changeRes.ok()) throw new Error(`medication change failed: ${changeRes.status()} ${await changeRes.text()}`);

  // 2. An allergy with the Phase 1 fields.
  const allergyRes = await ctx.post("/v1/profiles/current/allergies", {
    headers,
    data: { label: ALLERGY, severity: "moderate", category: "medication", criticality: "high" },
  });
  if (!allergyRes.ok()) throw new Error(`allergy create failed: ${allergyRes.status()} ${await allergyRes.text()}`);

  cookies = (await ctx.storageState()).cookies;
});

test.afterAll(async () => {
  await ctx?.dispose();
});

test("the timeline API projects the seeded events with patient-confirmed verification", async () => {
  const res = await ctx.get("/v1/profiles/current/health-timeline?limit=50", { headers: { "x-profile-id": profileId } });
  expect(res.ok(), `health-timeline: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { items: Array<{ kind: string; verification: string | null; summary: Record<string, unknown> }> };
  const kinds = body.items.map((i) => i.kind);
  expect(kinds).toContain("allergy_recorded");
  expect(kinds.some((k) => k === "medicine_started" || k === "medicine_changed")).toBe(true);
  // H-30: nothing the patient typed may arrive as provider/source verified.
  for (const item of body.items) {
    expect(item.verification, item.kind).not.toBe("provider_verified");
    expect(item.verification, item.kind).not.toBe("source_authenticated");
  }
});

test("timeline shows the medicine change and the allergy with the 'You added this' badge", async ({ page }) => {
  await openAs(page, "/health");

  const allergyRow = page.locator('[data-event-kind="allergy_recorded"]').first();
  await expect(allergyRow).toBeVisible();
  await expect(allergyRow).toContainText(ALLERGY);
  await expect(allergyRow.getByText("You added this")).toBeVisible();

  const medicineRow = page.locator('[data-event-kind="medicine_changed"], [data-event-kind="medicine_started"]').first();
  await expect(medicineRow).toBeVisible();
  await expect(medicineRow).toContainText("Amlodipine");
  await expect(medicineRow.getByText("You added this")).toBeVisible();

  // Never "verified" copy for patient-entered rows, anywhere on the screen.
  await expect(page.getByText("Verified by a clinic")).toHaveCount(0);
  await expect(page.getByText("From the source")).toHaveCount(0);

  // Tapping the medicine row lands on the existing medicine detail screen.
  await medicineRow.click();
  await expect(page).toHaveURL(new RegExp(`/medicines/${medicationId}$`));
});

test("kind-group filter chips narrow the feed", async ({ page }) => {
  await openAs(page, "/health");
  await expect(page.locator('[data-event-kind="allergy_recorded"]').first()).toBeVisible();

  const medicinesChip = page.getByRole("button", { name: "Medicines", exact: true });
  await medicinesChip.click();
  await expect(medicinesChip).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-event-kind="allergy_recorded"]')).toHaveCount(0);
  await expect(page.locator('[data-event-kind^="medicine_"]').first()).toBeVisible();

  // Switch to "Other": the allergy is back, the medicine rows are gone.
  await medicinesChip.click();
  await page.getByRole("button", { name: "Other", exact: true }).click();
  await expect(page.locator('[data-event-kind="allergy_recorded"]').first()).toBeVisible();
  await expect(page.locator('[data-event-kind^="medicine_"]')).toHaveCount(0);
});

test("recording a visit makes it appear on the timeline as a visit", async ({ page }) => {
  await openAs(page, "/health/visits/new");

  await page.getByRole("radio", { name: "Clinic visit" }).click();
  await page.getByLabel("Why did you go? (optional)").fill("Blood pressure review");
  await page.getByRole("button", { name: "Save visit" }).click();

  await expect(page).toHaveURL(/\/health\/visits\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Clinic visit" })).toBeVisible();
  await expect(page.getByText("Blood pressure review")).toBeVisible();

  await page.goto("/health");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Visits", exact: true }).click();
  const visitRow = page.locator('[data-event-kind="doctor_visit"]').first();
  await expect(visitRow).toBeVisible();
  await expect(visitRow).toContainText("Blood pressure review");
  await expect(visitRow.getByText("You added this")).toBeVisible();
});

test("Home shows the 'My health' summary card once the timeline has counts, linking to /health", async ({ page }) => {
  await openAs(page, "/");
  const card = page.getByTestId("my-health-card");
  await expect(card).toBeVisible();
  // One medicine reads as one medicine.
  await expect(card).toContainText(/1 medicine(?!s)/);
  await card.getByRole("button", { name: "See my health timeline" }).click();
  await expect(page).toHaveURL(/\/health$/);

  // The timeline is the front door: every record section is one tap away.
  const links = page.getByTestId("health-record-links");
  for (const [name, href] of [
    ["Conditions", "/conditions"],
    ["Measurements", "/measurements"],
    ["Test reports", "/reports"],
    ["Documents", "/documents"],
  ] as const) {
    await expect(links.getByRole("link", { name })).toHaveAttribute("href", href);
  }
});
