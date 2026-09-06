import { randomInt } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Condition hub, Phase 10 (docs_v2/06 P10-3, exit gate M10).
 *
 * The two properties the gate is about, asserted in the browser rather than
 * in a service test, because both are properties of the rendered page:
 *
 * - the causation caveat is present, in every locale;
 * - a derived link renders as a *question*, and nothing on the screen states
 *   it as a fact until the patient answers yes.
 *
 * Runs as its OWN user with its own seeded record, so it never depends on
 * what another spec left behind.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_API = process.env.E2E_APP_API_URL ?? process.env.E2E_API_URL ?? "http://localhost:4000";
const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

let ctx: APIRequestContext;
let profileId: string;
let conditionId: string;
let cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];

async function routeApi(page: Page) {
  if (API === APP_API) return;
  await page.context().route(`${APP_API}/**`, (route) => route.continue({ url: route.request().url().replace(APP_API, API) }));
  await page.goto("/manifest.webmanifest");
}

async function openAs(page: Page, path: string, locale = "en") {
  await page.context().addCookies(cookies);
  await page.context().addInitScript(
    ({ id, loc }) => {
      window.localStorage.setItem("medpass_locale", loc);
      window.localStorage.setItem("medpass_profile_id", id);
    },
    { id: profileId, loc: locale },
  );
  await routeApi(page);
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** A date `daysAgo` back, as a plain calendar date. */
function day(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
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

  const profileRes = await ctx.post("/v1/profiles", { data: { displayName: "Journey Test Patient", yearOfBirth: 1962, preferredLocale: "en" } });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  profileId = ((await profileRes.json()) as { id: string }).id;
  const headers = { "x-profile-id": profileId };

  async function post(path: string, data: Record<string, unknown>) {
    const res = await ctx.post(path, { headers, data });
    if (!res.ok()) throw new Error(`${path} failed: ${res.status()} ${await res.text()}`);
    return (await res.json()) as { id: string; rowVersion?: number };
  }

  const condition = await post("/v1/profiles/current/conditions", {
    label: "Type 2 diabetes mellitus",
    clinicalStatus: "active",
    onsetDate: "2023-04-10",
  });
  conditionId = condition.id;

  const doctor = await post("/v1/profiles/current/practitioners", { displayName: "Dr. Anitha Rao", speciality: "Endocrinology" });

  // Started 120 days ago, so the baseline and both follow-up windows land on
  // real dates rather than in the future.
  const medicine = await post("/v1/profiles/current/medications", {
    enteredName: "Metformin Hydrochloride 500mg",
    source: "manual",
    startDate: day(120),
    instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" },
  });
  const patched = await ctx.patch(`/v1/medications/${medicine.id}`, {
    headers,
    data: { rowVersion: medicine.rowVersion ?? 0, reasonConditionId: conditionId, prescribingPractitionerId: doctor.id },
  });
  if (!patched.ok()) throw new Error(`medication link failed: ${patched.status()} ${await patched.text()}`);

  // HbA1c either side of the start date: one in the baseline month, one about
  // 30 days after, one about 90 days after.
  for (const [daysAgo, value] of [
    [130, "9.1"],
    [90, "8.2"],
    [30, "7.4"],
  ] as const) {
    const report = await post("/v1/profiles/current/diagnostic-reports", {
      kind: "laboratory",
      category: "biochemistry",
      title: `Diabetes review ${daysAgo} days ago`,
      testedAt: day(daysAgo),
    });
    await post(`/v1/diagnostic-reports/${report.id}/results`, { analyteKey: "hba1c", enteredValueText: value });
  }

  cookies = (await ctx.storageState()).cookies;
});

test.afterAll(async () => {
  await ctx?.dispose();
});

test("the conditions list opens the hub without anyone typing a URL", async ({ page }) => {
  await openAs(page, "/conditions");
  const row = page.locator("[data-testid=\"condition-open-hub\"]").first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/conditions/${conditionId}$`));
  await expect(page.getByTestId("journey-caveat")).toBeVisible();
});

test("states plainly that this is timing, not cause", async ({ page }) => {
  await openAs(page, `/conditions/${conditionId}`);
  await expect(page.getByRole("heading", { name: "Type 2 diabetes mellitus" })).toBeVisible();

  const caveat = page.getByTestId("journey-caveat");
  await expect(caveat).toBeVisible();
  await expect(caveat).toContainText("around the same time");
  await expect(caveat).toContainText("does not show that one caused the other");

  // And nowhere on the page does it claim the opposite.
  await expect(page.getByText(/caused your|because of the medicine|improved by/i)).toHaveCount(0);
});

test("carries the caveat in every locale", async ({ page }) => {
  for (const locale of ["hi", "te", "ur"]) {
    await openAs(page, `/conditions/${conditionId}`, locale);
    const caveat = page.getByTestId("journey-caveat");
    await expect(caveat).toBeVisible();
    // Locale-independent assertion: the banner is non-empty and is not the
    // English string leaking through an untranslated key.
    const text = (await caveat.innerText()).trim();
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toContain("journey.caveat");
    expect(text).not.toContain("This page shows things");
  }
});

test("asks about a derived link instead of stating it", async ({ page }) => {
  await openAs(page, `/conditions/${conditionId}`);

  // The doctor is derived from the prescribing link, so the screen asks —
  // and does not yet list him under the doctors involved.
  const question = page.getByTestId("journey-suggestion-question").filter({ hasText: "Dr. Anitha Rao" });
  await expect(question.first()).toBeVisible();
  await expect(question.first()).toContainText("?");
  await expect(page.getByRole("button", { name: "Yes, that is right" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "No, not this one" }).first()).toBeVisible();

  const doctorsHeading = page.getByRole("heading", { name: "Doctors involved" });
  await expect(doctorsHeading).toBeVisible();
  await expect(page.getByText("No doctor is linked to this yet.")).toBeVisible();
});

test("answering yes moves the link out of the questions and into the facts", async ({ page }) => {
  await openAs(page, `/conditions/${conditionId}`);
  const doctorQuestion = page.getByTestId("journey-suggestion-question").filter({ hasText: "Dr. Anitha Rao" }).first();
  await expect(doctorQuestion).toBeVisible();

  // The Yes button belongs to the same card as the question.
  await doctorQuestion.locator("xpath=..").getByRole("button", { name: "Yes, that is right" }).click();

  await expect(page.getByText("No doctor is linked to this yet.")).toHaveCount(0);
  await expect(page.getByText("Dr. Anitha Rao").first()).toBeVisible();
});

test("shows the readings around the start date with their windows and no verdict", async ({ page }) => {
  await openAs(page, `/conditions/${conditionId}`);

  // Confirm the HbA1c link so the hub can build the before/after block.
  const analyteQuestion = page.getByTestId("journey-suggestion-question").filter({ hasText: /HbA1c/i }).first();
  await expect(analyteQuestion).toBeVisible();
  await analyteQuestion.locator("xpath=..").getByRole("button", { name: "Yes, that is right" }).click();

  await expect(page.getByRole("heading", { name: "Around the time you started" })).toBeVisible();
  await expect(page.getByTestId("journey-window-baseline")).toContainText("Around the start");
  await expect(page.getByTestId("journey-window-day30")).toContainText("About 30 days later");
  await expect(page.getByTestId("journey-window-day90")).toContainText("About 90 days later");
  await expect(page.getByTestId("journey-window-baseline")).toContainText("9.1");

  // The numbers are there; the claim is not.
  await expect(page.getByText(/improve|better|worse|% change|effective/i)).toHaveCount(0);
  await expect(page.getByText("They do not show that the medicine caused the change.").first()).toBeVisible();
});
