import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, request, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Documents V2 (docs_v2/09): drives the REAL capture → upload → classify →
 * "What is this?" → review → save flow through the browser against the
 * running api, object storage and worker (Tesseract OCR on a committed
 * synthetic prescription page — no mocks). Proves:
 *   - the classifier's guess is shown and the person's choice sets the kind
 *   - candidates arrive grouped, each with its bounding box outlined
 *   - dose quantity is never offered as a proposal (H-02) and is typed
 *   - confirming the medicine creates a PatientMedication with OCR provenance
 *   - the list and detail screens show the document
 *   - a discharge summary routes to the explanation screen with no
 *     "add these medicines" action (H-34)
 *
 * Runs as its OWN user (the shared reflow/axe fixture must stay untouched)
 * and serially with `--workers=1`: OCR is CPU-bound and the worker is one
 * process.
 */
const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_API = process.env.E2E_APP_API_URL ?? process.env.E2E_API_URL ?? "http://localhost:4000";
const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
const FIXTURE = join(__dirname, "../../api/test/fixtures/prescription-page-1.png");

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const galleryInput = 'input[type="file"][multiple]';

let ctx: APIRequestContext;
let profileId: string;
let cookies: Awaited<ReturnType<APIRequestContext["storageState"]>>["cookies"];
let documentId: string;

async function routeApi(page: Page) {
  if (API === APP_API) return;
  await page.context().route(`${APP_API}/**`, (route) => route.continue({ url: route.request().url().replace(APP_API, API) }));
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

  const profileRes = await ctx.post("/v1/profiles", {
    data: { displayName: "Documents V2 Test Patient", yearOfBirth: 1961, preferredLocale: "en" },
  });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  profileId = ((await profileRes.json()) as { id: string }).id;
  cookies = (await ctx.storageState()).cookies;
});

test.afterAll(async () => {
  await ctx?.dispose();
});

test("/add/scan hands off to the new flow with the kind pre-set to prescription", async ({ page }) => {
  await openAs(page, "/add/scan");
  await expect(page).toHaveURL(/\/documents\/new\?kind=prescription$/);
  await expect(page.getByRole("heading", { name: "Add a document" })).toBeVisible();
});

test("capture → upload → 'What is this?' → review: confirming the medicine creates it with a typed dose", async ({ page }) => {
  test.setTimeout(300_000);
  await openAs(page, "/documents/new?kind=prescription");

  // Capture: the committed fixture is one printed prescription page.
  await page.setInputFiles(galleryInput, [FIXTURE]);
  await expect(page.getByTestId("captured-page")).toHaveCount(1);
  await expect(page.getByText("prescription-page-1.png")).toBeVisible();

  // Reorder controls exist even for one page (disabled at the edges) — the
  // page can be dropped before anything is sent.
  await expect(page.getByRole("button", { name: "Move page 1 up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Remove page 1" })).toBeEnabled();

  await page.getByRole("button", { name: "Send this page" }).click();

  // Classification runs in the worker; the guess appears with confidence wording.
  await expect(page.getByRole("heading", { name: "What is this?" })).toBeVisible({ timeout: 120_000 });
  const guess = page.getByTestId("classifier-guess");
  await expect(guess).toBeVisible();
  await expect(guess).toContainText(/prescription/i);
  documentId = new URL(page.url()).pathname.split("/").pop() ?? "";

  // The pre-set kind is selected; the person's tap sets it for good.
  await expect(page.getByRole("radio", { name: "Prescription", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: /Yes, that's right|Continue/ }).click();

  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}\/review$/, { timeout: 30_000 });
  documentId = new URL(page.url()).pathname.split("/")[2] ?? "";
  expect(documentId).toMatch(/^[0-9a-f-]{36}$/);

  // The kind the person chose is on the record, and the classifier is barred from moving it.
  const docRes = await ctx.get(`/v1/patient-documents/${documentId}`, { headers: { "x-profile-id": profileId } });
  expect(docRes.ok()).toBe(true);
  const doc = (await docRes.json()) as { kind: string; classification: { classifiedBy: string | null; kind: string | null } };
  expect(doc.kind).toBe("prescription");
  expect(doc.classification.classifiedBy).toBe("user");

  // Review: candidates arrive grouped, each against its page crop.
  const medicineGroup = page.locator('[data-testid="candidate-group"][data-entity="medication"]').first();
  await expect(medicineGroup).toBeVisible({ timeout: 150_000 });
  // The page the line was read from is shown beside the group; the
  // outlined box is drawn whenever the extractor supplied one (the
  // deterministic extractor on a PDF text layer or on OCR without word
  // boxes reports null, and then no box may be invented).
  await expect(medicineGroup.locator('img[alt^="Page"]')).toBeVisible();
  const extractionRes = await ctx.get(`/v1/patient-documents/${documentId}/extraction`, { headers: { "x-profile-id": profileId } });
  const extraction = (await extractionRes.json()) as { extraction: { groups: Array<{ targetEntity: string; candidates: Array<{ boundingBox: unknown }> }> } };
  const medicineHasBox = extraction.extraction.groups.some((g) => g.targetEntity === "medication" && g.candidates.some((c) => c.boundingBox));
  await expect(medicineGroup.getByTestId("candidate-box")).toHaveCount(medicineHasBox ? 1 : 0);

  // H-02: dose quantity is never a proposal, anywhere on the screen.
  await expect(page.locator('[data-candidate-field="medication.doseQuantity"]')).toHaveCount(0);
  await expect(page.locator('[data-candidate-field="diagnostic_result.interpretation"]')).toHaveCount(0);

  // The medicine name was read off the page. Select it if the confidence
  // bucket did not pre-select it (only "high" is ever pre-selected).
  const brand = medicineGroup.locator('[data-candidate-field="medication.brandName"]').first();
  await expect(brand).toBeVisible();
  await expect(brand.getByTestId("candidate-value")).toContainText(/glycomet/i);
  if ((await brand.getAttribute("data-selected")) !== "true") {
    await brand.getByRole("button", { name: "Yes", exact: true }).click();
  }
  await expect(brand).toHaveAttribute("data-selected", "true");

  // Low-confidence proposals are collapsed and never pre-selected.
  for (const low of await page.locator('[data-testid="candidate"][data-bucket="low"]').all()) {
    await expect(low).toHaveAttribute("data-selected", "false");
  }

  // The dose is typed, never read: the picker sits with the medicine and
  // defaults to 1 tablet; make the choice explicit anyway.
  const dose = medicineGroup.getByTestId("medication-dose");
  await expect(dose).toBeVisible();
  await expect(dose).toContainText("never read the amount from a photo");
  await dose.getByRole("radio", { name: "Tablet", exact: true }).click();
  await dose.getByRole("radio", { name: "1", exact: true }).click();

  // The frequency was read from the page; if it wasn't pre-selected, say yes to it.
  const frequency = medicineGroup.locator('[data-candidate-field="medication.frequency"]').first();
  if ((await frequency.count()) > 0 && (await frequency.getAttribute("data-selected")) !== "true") {
    await frequency.getByRole("button", { name: "Yes", exact: true }).click();
  }

  await page.getByRole("button", { name: /Save all confirmed/ }).click();
  await expect(page.getByTestId("review-done")).toBeVisible({ timeout: 60_000 });
  const medicineLink = page.locator('[data-testid="created-link"][data-entity-type="patient_medication"]').first();
  await expect(medicineLink).toBeVisible();

  // The medicine exists, carries the page it came from, and is the patient's own confirmation — never "verified".
  const meds = await ctx.get("/v1/profiles/current/medications", { headers: { "x-profile-id": profileId } });
  expect(meds.ok()).toBe(true);
  const items = ((await meds.json()) as { items: Array<{ enteredName: string; provenance?: { source?: string; verification?: string } }> }).items;
  const created = items.find((m) => /glycomet/i.test(m.enteredName));
  expect(created, `medicine created from the document: ${JSON.stringify(items.map((m) => m.enteredName))}`).toBeTruthy();
  if (created?.provenance?.verification) expect(created.provenance.verification).toBe("patient_confirmed");
  if (created?.provenance?.source) expect(created.provenance.source).toBe("ocr_extracted");

  // The done screen links to the medicine detail screen.
  await medicineLink.click();
  await expect(page).toHaveURL(/\/medicines\/[0-9a-f-]{36}$/);
});

test("the documents list and detail show the uploaded document", async ({ page }) => {
  await openAs(page, "/documents");
  const row = page.locator(`[data-testid="document-row"][href$="/documents/${documentId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Prescription");
  await expect(row).toContainText("1 pages");

  // Kind filter narrows the list.
  await page.getByRole("button", { name: "Test report", exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(row).toBeVisible();

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/documents/${documentId}$`));
  await expect(page.getByTestId("document-kind")).toHaveText("Prescription");
  await expect(page.getByTestId("document-page")).toHaveCount(1);
  await expect(page.getByTestId("document-page").locator("img")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review what we found" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove this document" })).toBeVisible();
});

test("H-34: choosing 'Hospital discharge summary' routes to the explanation screen with no add-medicines action", async ({ page }) => {
  test.setTimeout(300_000);
  await openAs(page, "/documents/new");
  await page.setInputFiles(galleryInput, [FIXTURE]);
  await page.getByRole("button", { name: "Send this page" }).click();
  await expect(page.getByRole("heading", { name: "What is this?" })).toBeVisible({ timeout: 120_000 });

  // The person's choice always wins over the classifier's guess.
  await page.getByRole("radio", { name: "Hospital discharge summary", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}\/discharge$/, { timeout: 30_000 });
  const explanation = page.getByTestId("discharge-explanation");
  await expect(explanation).toBeVisible();
  await expect(explanation).toContainText("reviewed with your doctor");
  await expect(page.getByRole("button", { name: /add (these|this) medicine/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save all confirmed/ })).toHaveCount(0);

  const id = new URL(page.url()).pathname.split("/")[2] ?? "";
  const docRes = await ctx.get(`/v1/patient-documents/${id}`, { headers: { "x-profile-id": profileId } });
  const doc = (await docRes.json()) as { kind: string; classification: { classifiedBy: string | null } };
  expect(doc.kind).toBe("discharge_summary");
  expect(doc.classification.classifiedBy).toBe("user");

  // The detail screen keeps the same stance: explanation, never a medicines CTA.
  await page.getByRole("button", { name: "See the document" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${id}$`));
  await expect(page.getByText("not added automatically")).toBeVisible();
  await expect(page.getByRole("button", { name: "Review what we found" })).toHaveCount(0);
});

test("share-target landing with nothing shared teaches and offers the normal entry point", async ({ page }) => {
  await openAs(page, "/share-target");
  await expect(page.getByText("Nothing was shared")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a document" })).toBeVisible();
});
