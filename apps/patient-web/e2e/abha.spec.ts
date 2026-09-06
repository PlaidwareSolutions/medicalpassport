import { expect, test, type Page } from "@playwright/test";
import { createFreshPatient, patientHeaders, type FreshPatient } from "./fresh-patient";

/**
 * ABHA and ABDM against the in-process mock gateway (docs_v2/08 §9): with
 * no ABDM credentials the API replays recorded sandbox fixtures, so link →
 * discover → link care contexts → receive → import runs end to end here
 * exactly as it will on the sandbox.
 *
 * The two claims this spec exists to hold: an ABDM consent is shown on a
 * screen that says it is *not* one of the app's own shares, and importing a
 * received bundle lands in the document confirmation queue rather than
 * writing records — a hospital's copy of your record is a claim until you
 * confirm it.
 */
test.describe.configure({ mode: "serial" });

/** The mock gateway's fixed OTP (apps/api/src/modules/abdm/gateway-client.ts). */
const MOCK_OTP = "000000";
const ABHA_NUMBER = "91-1234-5678-9012";

let patient: FreshPatient;

async function open(page: Page, route: string) {
  await page.goto(route);
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.beforeAll(async () => {
  // One OTP cooldown (~31 s) is waited out for the step-up below.
  test.setTimeout(180_000);
  patient = await createFreshPatient("abha", "ABHA Test Patient");
  // `abha/link/init` and `abdm/consents/:id/revoke` are step-up guarded;
  // the sheet itself is covered by step-up.spec.ts, so the session is
  // re-verified over the API and the browser stays on these screens.
  await patient.stepUp();
});

test.afterAll(async () => {
  await patient?.dispose();
});

test("linking an ABHA, then care contexts, then importing what arrives", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ storageState: patient.storageState });
  const page = await context.newPage();

  // ── not connected, and honest that it is optional ──────────────
  await open(page, "/abha");
  await expect(page.getByTestId("abha-not-linked")).toBeVisible();
  await expect(page.getByText("You do not need an ABHA.", { exact: false })).toBeVisible();

  // ── link by ABHA number ────────────────────────────────────────
  await page.getByRole("radio", { name: "With my ABHA number" }).click();
  await page.getByLabel("ABHA number").fill(ABHA_NUMBER);
  await page.getByTestId("abha-send-code").click();

  const otpCard = page.getByTestId("abha-otp");
  await expect(otpCard).toBeVisible({ timeout: 20_000 });
  await otpCard.getByLabel("Enter the 6-digit code").fill(MOCK_OTP);
  await page.getByTestId("abha-verify").click();

  const linked = page.getByTestId("abha-linked");
  await expect(linked).toBeVisible({ timeout: 20_000 });
  // Masked, never the whole number in a list (docs_v2/05 §10).
  await expect(linked).toContainText("91-XXXX-XXXX-9012");

  // ── discover and link care contexts at the mock HIP ────────────
  await open(page, "/abha/care-contexts");
  await page.getByTestId("abha-discover").click();
  await expect(page.getByRole("heading", { name: /Mock City Hospital/ })).toBeVisible({ timeout: 20_000 });

  const contexts = page.getByTestId("care-context");
  await expect(contexts).toHaveCount(2);
  for (const box of await contexts.locator('input[type="checkbox"]').all()) await box.check();

  await page.getByTestId("link-care-contexts").click();
  const contextOtp = page.getByTestId("care-context-otp");
  await expect(contextOtp).toBeVisible({ timeout: 20_000 });
  await contextOtp.getByLabel("Enter the 6-digit code").fill(MOCK_OTP);
  await page.getByTestId("care-context-verify").click();
  await expect(page.getByTestId("care-contexts-linked")).toBeVisible({ timeout: 20_000 });

  // ── the bundle the mock HIP transferred is waiting, not applied ─
  await open(page, "/abha/records");
  const bundle = page.getByTestId("abdm-bundle");
  await expect(bundle).toHaveCount(1);
  await expect(bundle).toHaveAttribute("data-status", "received");
  await expect(bundle).toContainText("Prescriptions");
  await expect(bundle).toContainText("Waiting for you");

  // Nothing has been written to the record yet.
  const before = await patient.ctx.get("/v1/profiles/current/medications", { headers: patientHeaders(patient.profileId) });
  expect(((await before.json()) as { items: unknown[] }).items).toHaveLength(0);

  // ── import lands in the existing confirmation queue ────────────
  await page.getByTestId("import-bundle").click();
  await page.waitForURL(/\/documents\/[0-9a-f-]+\/review$/, { timeout: 30_000 });
  // Still nothing written: the queue is where each line is confirmed.
  const after = await patient.ctx.get("/v1/profiles/current/medications", { headers: patientHeaders(patient.profileId) });
  expect(((await after.json()) as { items: unknown[] }).items).toHaveLength(0);

  await context.close();
});

test("ABDM consents are a screen of their own, and can be revoked", async ({ browser }) => {
  const context = await browser.newContext({ storageState: patient.storageState });
  const page = await context.newPage();

  await open(page, "/abha/consents");
  // The distinction from the app's own share links is stated, not implied.
  await expect(page.getByText("These are not the same as the links you share from this app.", { exact: false })).toBeVisible();

  const consent = page.getByTestId("abdm-consent");
  await expect(consent).toHaveCount(1);
  await expect(consent).toHaveAttribute("data-status", "granted");
  await expect(consent).toContainText("Prescriptions");

  await page.getByTestId("revoke-consent").click();
  await page.getByTestId("confirm-revoke-consent").click();
  await expect(page.getByTestId("abdm-consent")).toHaveAttribute("data-status", "revoked", { timeout: 20_000 });

  await context.close();
});

test("unlinking says that imported records stay, before it is done", async ({ browser }) => {
  const context = await browser.newContext({ storageState: patient.storageState });
  const page = await context.newPage();

  await open(page, "/abha");
  await expect(page.getByTestId("abha-linked")).toBeVisible();
  // The consequence is on the screen before the button is ever pressed.
  await expect(page.getByText("Records already brought in stay in your record", { exact: false }).first()).toBeVisible();

  await page.getByTestId("abha-unlink").click();
  await expect(page.getByText("Only the connection ends.", { exact: false })).toBeVisible();
  await page.getByTestId("abha-unlink-confirm").click();

  await expect(page.getByTestId("abha-not-linked")).toBeVisible({ timeout: 20_000 });

  // The document the import created is still there, with its provenance.
  const docs = await patient.ctx.get("/v1/profiles/current/patient-documents", { headers: patientHeaders(patient.profileId) });
  expect(docs.ok(), `documents list: ${docs.status()}`).toBe(true);
  const items = ((await docs.json()) as { items: Array<{ sourceChannel?: string }> }).items;
  expect(items.length).toBeGreaterThan(0);
  expect(items.some((d) => d.sourceChannel === "abdm")).toBe(true);

  await context.close();
});
