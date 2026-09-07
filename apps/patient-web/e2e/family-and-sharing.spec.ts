import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, request, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

/**
 * V2 Phase 6/7 (docs_v2/06 P6-2, P6-3, P7-3): the family dashboard, the
 * scope-aware UI and the WHAT / WHO / HOW LONG share flow, against the real
 * API with a real caregiver relationship.
 *
 * The relationship is seeded through the API exactly as a patient would
 * create it — invite (step-up guarded), then the caregiver accepts from
 * their own session — because the thing under test is what a *narrowly
 * scoped* caregiver sees, and that only means something if the scopes came
 * from the real authorization path rather than a fixture.
 *
 * The caregiver here holds `view_medications` and nothing else. Under
 * `PROFILE_SCOPE_GRANTS` that also grants view_profile / view_tests /
 * view_measurements / view_documents (they used to live under view_profile,
 * so the narrow scopes are additive), but grants no write anywhere and no
 * `view_schedule` or `manage_reminders`. That is what makes it a good
 * probe: some of the dashboard is visible, some is not, and none of the
 * actions are.
 */

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
const APP_API = process.env.E2E_APP_API_URL ?? "http://localhost:4000";
const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
const AUTH_DIR = join(__dirname, ".auth");

/** Every OTP send to one number starts a per-number cooldown; a step-up send counts. */
const SEND_COOLDOWN_MS = 31_000;

function newPhone(): string {
  return "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}

interface Actor {
  ctx: APIRequestContext;
  phone: string;
  storageState: string;
}

async function login(phone: string): Promise<Actor> {
  const ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { "x-requested-with": "medpass" } });
  const requested = await ctx.post("/v1/auth/otp/request", { data: { phone } });
  expect(requested.ok(), `otp/request ${requested.status()}`).toBe(true);
  const verified = await ctx.post("/v1/auth/otp/verify", {
    data: { phone, code: OTP_CODE, device: { kind: "browser" }, locale: "en", rememberDevice: true },
  });
  expect(verified.ok(), `otp/verify ${verified.status()}`).toBe(true);

  mkdirSync(AUTH_DIR, { recursive: true });
  const storageState = join(AUTH_DIR, `fs-${phone.replace(/\D/g, "")}.json`);
  await ctx.storageState({ path: storageState });
  return { ctx, phone, storageState };
}

/** Caregiver management and share creation are step-up guarded (ADR-V2-012). */
async function stepUp(actor: Actor, sinceLastSend: number): Promise<void> {
  const waitMs = SEND_COOLDOWN_MS - (Date.now() - sinceLastSend);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  const requested = await actor.ctx.post("/v1/auth/step-up");
  expect(requested.ok(), `step-up ${requested.status()} ${await requested.text()}`).toBe(true);
  const verified = await actor.ctx.post("/v1/auth/step-up/verify", { data: { code: OTP_CODE } });
  expect(verified.ok(), `step-up/verify ${verified.status()} ${await verified.text()}`).toBe(true);
}

/**
 * Opens a browser as one signed-in user, with the active profile pinned
 * before any script runs — otherwise the app picks the first profile the
 * session can see, which is only incidentally the one under test.
 */
async function pageFor(browser: Browser, actor: Actor, profileId: string): Promise<Page> {
  const context = await browser.newContext({ storageState: actor.storageState });
  await context.addInitScript((id) => {
    window.localStorage.setItem("medpass_profile_id", id as string);
  }, profileId);
  const page = await context.newPage();
  if (API !== APP_API) {
    await context.route(`${APP_API}/**`, (route) => route.continue({ url: route.request().url().replace(APP_API, API) }));
    // Interception attaches on the first navigation; warm a script-free URL
    // so the app's very first fetch is already rewritten (see step-up.spec).
    await page.goto("/manifest.webmanifest");
  }
  return page;
}

test.describe("family dashboard and scope-aware UI", () => {
  // One seeded relationship shared by the tests below; the OTP cooldown
  // makes re-seeding per test expensive and buys nothing.
  test.describe.configure({ mode: "serial" });

  let patient: Actor;
  let caregiver: Actor;
  let profileId: string;
  let sharedDocumentId: string;
  const patientName = "Scope Probe Patient";

  /** A real 1x1 PNG — the upload path checks the bytes, not just the header. */
  const PAGE_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  test.beforeAll(async () => {
    test.setTimeout(180_000);

    const loggedInAt = Date.now();
    patient = await login(newPhone());
    caregiver = await login(newPhone());

    const profileRes = await patient.ctx.post("/v1/profiles", {
      data: { displayName: patientName, yearOfBirth: 1949, preferredLocale: "en" },
    });
    expect(profileRes.ok(), `profile ${profileRes.status()}`).toBe(true);
    profileId = ((await profileRes.json()) as { id: string }).id;

    // A medicine so "see the medicines" is not vacuously satisfied.
    const medRes = await patient.ctx.post("/v1/profiles/current/medications", {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      data: {
        enteredName: "Amlodipine 5mg",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-0-0", foodInstruction: "any" },
      },
    });
    expect(medRes.ok(), `medication ${medRes.status()}`).toBe(true);

    await stepUp(patient, loggedInAt);

    const invited = await patient.ctx.post("/v1/profiles/current/caregivers", {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      // Deliberately narrow: one read scope, no writes, no schedule.
      data: { phone: caregiver.phone, scopes: ["view_medications"], relationship: "child", label: "Meena" },
    });
    expect(invited.ok(), `invite ${invited.status()} ${await invited.text()}`).toBe(true);

    const invitations = await caregiver.ctx.get("/v1/caregivers/invitations");
    expect(invitations.ok(), `invitations ${invitations.status()}`).toBe(true);
    const items = ((await invitations.json()) as { items: Array<{ id: string }> }).items;
    expect(items.length, "the invitation reached the caregiver").toBeGreaterThan(0);

    const accepted = await caregiver.ctx.post("/v1/caregivers/accept", { data: { invitationId: items[0]!.id } });
    expect(accepted.ok(), `accept ${accepted.status()} ${await accepted.text()}`).toBe(true);

    // Re-save: acceptance can rotate the session cookie.
    await caregiver.ctx.storageState({ path: caregiver.storageState });

    // A link made with exactly two sections, on the step-up the invite just
    // established (fresh for 10 minutes) — one OTP send, not two. What this
    // link must still show later is exactly those two sections: the
    // frozen-snapshot guarantee (docs_v2/06 P7 exit gate, "old links never
    // widen").
    const created = await patient.ctx.post("/v1/profiles/current/shares", {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      data: {
        // Every key, explicitly: the server merges a partial map over a
        // default in which nearly everything is true.
        sections: {
          medications: true,
          allergies: true,
          conditions: false,
          recentChanges: false,
          concerns: false,
          glucoseReadings: false,
          bloodPressureReadings: false,
          weightReadings: false,
          checkups: false,
          prescriptions: false,
          reports: false,
          measurements: false,
          documents: false,
          encounters: false,
        },
        audience: "doctor",
        expiresIn: "24h",
        kind: "link",
      },
    });
    expect(created.ok(), `share ${created.status()} ${await created.text()}`).toBe(true);

    // ── V2-shaped data, and a link that carries all of it ──────────────
    // The QA finding this covers: a patient whose readings, reports, visits
    // and documents are all V2 shared a link that showed none of them.
    const profileHeaders = { "x-profile-id": profileId, "idempotency-key": randomUUID() };

    const report = await patient.ctx.post("/v1/profiles/current/diagnostic-reports", {
      headers: profileHeaders,
      data: { kind: "laboratory", title: "Quarterly panel", testedAt: "2026-09-01", facilityNameText: "Metro Labs" },
    });
    expect(report.ok(), `diagnostic report ${report.status()} ${await report.text()}`).toBe(true);
    const reportId = ((await report.json()) as { id: string }).id;
    const result = await patient.ctx.post(`/v1/diagnostic-reports/${reportId}/results`, {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      data: { analyteKey: "hba1c", enteredValueText: "6.8", referenceText: "4.0 - 5.6" },
    });
    expect(result.ok(), `result ${result.status()} ${await result.text()}`).toBe(true);

    const observation = await patient.ctx.post("/v1/profiles/current/observations", {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      data: { concept: "blood_pressure", valueNumeric: 128, valueNumeric2: 82, measuredAt: new Date().toISOString() },
    });
    expect(observation.ok(), `observation ${observation.status()} ${await observation.text()}`).toBe(true);

    const encounter = await patient.ctx.post("/v1/profiles/current/encounters", {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      data: { kind: "outpatient", startedAt: new Date().toISOString(), reasonText: "Quarterly review" },
    });
    expect(encounter.ok(), `encounter ${encounter.status()} ${await encounter.text()}`).toBe(true);

    // Two lines on one prescription — the count that used to read "0 medicine(s)".
    const prescription = await patient.ctx.post("/v1/profiles/current/prescriptions", {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      data: {
        practitionerName: "Dr Sharma",
        prescribedAt: "2026-09-01",
        items: [
          { enteredName: "Metformin 500", doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" },
          { enteredName: "Amlodipine 5", doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
        ],
      },
    });
    expect(prescription.ok(), `prescription ${prescription.status()} ${await prescription.text()}`).toBe(true);

    const document = await patient.ctx.post("/v1/profiles/current/patient-documents", {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      data: { sourceChannel: "camera", title: "Dr Sharma visit", pages: [{ contentType: "image/png", sizeBytes: PAGE_PNG.length }] },
    });
    expect(document.ok(), `document ${document.status()} ${await document.text()}`).toBe(true);
    const documentBody = (await document.json()) as { id: string; pages: Array<{ uploadUrl: string }> };
    sharedDocumentId = documentBody.id;
    const uploaded = await patient.ctx.put(documentBody.pages[0]!.uploadUrl.replace(/^https?:\/\/[^/]+/, ""), {
      headers: { "content-type": "image/png" },
      data: PAGE_PNG,
    });
    expect(uploaded.ok(), `page upload ${uploaded.status()}`).toBe(true);
    const completed = await patient.ctx.post(`/v1/patient-documents/${sharedDocumentId}/pages/1/complete`, {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
    });
    expect(completed.ok(), `page complete ${completed.status()} ${await completed.text()}`).toBe(true);

  });

  test.afterAll(async () => {
    await patient?.ctx.dispose();
    await caregiver?.ctx.dispose();
  });

  test("the caregiver's dashboard shows the patient, and says which summaries are not theirs to see", async ({ browser }) => {
    const page = await pageFor(browser, caregiver, profileId);
    await page.goto("/family");

    const card = page.getByTestId("family-card").filter({ hasText: patientName });
    await expect(card).toBeVisible();

    // view_medications grants no view_schedule and no manage_reminders, so
    // both counts come back null — and null must read as "not yours to
    // see", never as a blank or a zero.
    await expect(card.getByText("You do not have access to this")).toHaveCount(2);
    await expect(card).not.toContainText("0 still to take");

    // The scopes they do hold are named, so they can see what they were given.
    await expect(card).toContainText("View medicines");
    await page.close();
  });

  test("the caregiver is told, in words, which actions are not part of their access", async ({ browser }) => {
    const page = await pageFor(browser, caregiver, profileId);

    await page.goto("/documents");
    await expect(page.getByTestId("scope-notice-upload_documents")).toBeVisible();
    await expect(page.getByRole("link", { name: "Add a document" })).toHaveCount(0);

    await page.goto("/reports");
    await expect(page.getByTestId("scope-notice-upload_tests")).toBeVisible();

    await page.goto("/measurements/blood_pressure");
    await expect(page.getByTestId("scope-notice-add_measurements")).toBeVisible();
    // Not a greyed-out button that looks broken — the control is gone and a
    // sentence stands in its place (docs_v2/06 P6-2).
    await expect(page.getByRole("button", { name: "Add reading" })).toHaveCount(0);

    // The notice names the patient and the action, so the caregiver knows
    // what to ask for rather than just that they were refused.
    await expect(page.getByTestId("scope-notice-add_measurements")).toContainText(patientName);
    await page.close();
  });

  test("the patient sees who changed what, in plain words and without codes or ids", async ({ browser }) => {
    const page = await pageFor(browser, patient, profileId);
    await page.goto("/activity");

    // The caregiver's acceptance is itself an activity row.
    const rows = page.getByTestId("activity-row");
    await expect(rows.first()).toBeVisible();
    const text = (await page.locator("body").innerText()).toLowerCase();
    // Never the audit vocabulary: no dotted action codes, no uuids.
    expect(text).not.toMatch(/[a-z_]+\.(created|updated|deleted|accepted|revoked)\b/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    await page.close();
  });

  test("notification settings offer per-kind controls, and no way to mute a dose reminder", async ({ browser }) => {
    const page = await pageFor(browser, patient, profileId);
    await page.goto("/profile/notifications");

    // The two exempt kinds are stated as always on, with a reason — not
    // rendered as a disabled switch that reads as a bug (H-48).
    await expect(page.getByTestId("notify-always-on-dose_reminder")).toBeVisible();
    await expect(page.getByTestId("notify-always-on-caregiver_escalation")).toBeVisible();
    await expect(page.getByTestId("notify-dose_reminder-off")).toHaveCount(0);
    await expect(page.getByTestId("notify-caregiver_escalation-off")).toHaveCount(0);

    // A kind that may be turned down has all three frequencies.
    for (const frequency of ["immediate", "daily_digest", "off"]) {
      await expect(page.getByTestId(`notify-refill-${frequency}`)).toBeVisible();
    }
    await page.close();
  });

  test("an existing link lists exactly the sections it was made with", async ({ browser }) => {
    const page = await pageFor(browser, patient, profileId);
    await page.goto("/share");

    await expect(page.getByText("A doctor")).toBeVisible();
    const shows = page.getByText(/^Shows:/);
    await expect(shows).toContainText("Current medicines");
    await expect(shows).toContainText("Allergies");
    // The sections it was not made with must not appear, however many new
    // sections the app has learned since.
    await expect(shows).not.toContainText("Uploaded documents");
    await expect(shows).not.toContainText("Home readings");
    await expect(page.getByText(/only ever shows what you chose/)).toBeVisible();
    await page.close();
  });

  test("the new-share screen offers the sections, an audience and the expiry presets", async ({ browser }) => {
    const page = await pageFor(browser, patient, profileId);
    await page.goto("/share/new");

    // Documents are off by default: a link that opens every page of every
    // document is chosen by name or not at all.
    await expect(page.getByTestId("share-section-documents")).not.toBeChecked();
    await expect(page.getByTestId("share-section-measurements")).toBeChecked();
    await expect(page.getByTestId("share-section-encounters")).toBeChecked();

    for (const preset of ["15m", "1h", "24h", "7d"]) {
      await expect(page.getByTestId(`share-expiry-${preset}`)).toBeVisible();
    }
    await expect(page.getByRole("radio", { name: "A pharmacy" })).toBeVisible();

    // Full passport takes over every box, and says so rather than leaving a
    // narrower selection on screen than the link would carry.
    await page.getByTestId("share-section-full_passport").check();
    await expect(page.getByTestId("share-section-documents")).toBeChecked();
    await expect(page.getByTestId("share-section-documents")).toBeDisabled();
    await page.getByTestId("share-section-full_passport").uncheck();
    await page.close();
  });

  /**
   * The recipient's own view, over a record whose readings, reports, visits
   * and documents are all V2. This is the QA finding: the summary was still
   * V1-shaped, so a patient like this shared a link that showed no readings
   * at all, no documents and no visits.
   *
   * Opened without a session, exactly as a doctor opens it.
   */
  test("a full-passport link shows the V2 record: home readings, visits, documents with their pages, and reports with their values", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    if (API !== APP_API) {
      await context.route(`${APP_API}/**`, (route) => route.continue({ url: route.request().url().replace(APP_API, API) }));
    }
    // Made here rather than in beforeAll so the share list stays exactly the
    // one link the test above asserts on. The step-up taken during setup is
    // still fresh (10 minutes), so this costs no extra OTP.
    const fullPassport = await patient.ctx.post("/v1/profiles/current/shares", {
      headers: { "x-profile-id": profileId, "idempotency-key": randomUUID() },
      data: { sections: { full_passport: true }, audience: "clinic", expiresIn: "24h", kind: "link" },
    });
    expect(fullPassport.ok(), `full passport ${fullPassport.status()} ${await fullPassport.text()}`).toBe(true);
    const fullPassportToken = ((await fullPassport.json()) as { token: string }).token;

    const page = await context.newPage();
    // Interception attaches on the first navigation (see pageFor) — warm a
    // script-free URL so the share page's very first fetch is rewritten.
    if (API !== APP_API) await page.goto("/manifest.webmanifest");
    await page.goto(`/s/${fullPassportToken}`);
    await expect(page.getByRole("heading", { name: patientName })).toBeVisible();

    // Home measurements: the number as recorded, in its unit, with the
    // arithmetic behind it — and never a high/low/normal judgement (H-25).
    await expect(page.getByText("Home readings (last 30 days)")).toBeVisible();
    await expect(page.getByText("Blood pressure", { exact: true })).toBeVisible();
    await expect(page.getByText("128/82 mmHg").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    // Visits, and the reason in the patient's own words.
    await expect(page.getByText("Visits (last 90 days)")).toBeVisible();
    await expect(page.getByText("Quarterly review")).toBeVisible();

    // The V2 test report, its kind named rather than left as `laboratory`,
    // and the value exactly as printed with the unit and range.
    await expect(page.getByText("Quarterly panel")).toBeVisible();
    await expect(page.getByText("Metro Labs")).toBeVisible();
    await expect(page.getByText(/HbA1c.*6\.8 %/)).toBeVisible();
    expect(body).not.toContain("laboratory");

    // The prescription counts its own lines.
    await expect(page.getByText("2 medicines")).toBeVisible();

    // Documents, and the pages themselves through the public page route —
    // the whole point of ticking documents.
    await expect(page.getByText("Documents on record")).toBeVisible();
    await expect(page.getByText("Dr Sharma visit")).toBeVisible();
    const pageImage = page.locator(`img[src*="/public/shares/${fullPassportToken}/documents/${sharedDocumentId}/pages/1"]`);
    await expect(pageImage).toBeVisible();
    // It is a real image, not a broken one: the route redirected and served bytes.
    await expect.poll(() => pageImage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

    // Nothing anywhere reads as an internal code.
    expect(body).not.toMatch(/reconciled_|status_changed|dose_unit_confirmed|pending_upload/);
    await page.close();
    await context.close();
  });

  test("the preview names every section, including the ones that are not shared", async ({ browser }) => {
    const page = await pageFor(browser, patient, profileId);
    await page.goto("/share/new");

    await page.getByTestId("share-section-glucoseReadings").uncheck();
    await page.getByRole("button", { name: "See what they will see" }).click();

    const preview = page.getByTestId("share-preview");
    await expect(preview).toBeVisible();
    await expect(preview.getByTestId("preview-section-medications")).toHaveAttribute("data-shared", "yes");
    // An unshared section is listed and marked, not omitted: "what did I
    // leave out" is as important as "what did I include".
    await expect(preview.getByTestId("preview-section-glucoseReadings")).toHaveAttribute("data-shared", "no");
    await expect(preview.getByTestId("preview-section-glucoseReadings")).toContainText("not shared");
    await expect(preview.getByTestId("preview-section-documents")).toHaveAttribute("data-shared", "no");
    // Counted from the same builder the recipient sees: the V2 reports,
    // readings and visits are no longer reported as "(0)".
    await expect(preview.getByTestId("preview-section-reports")).toContainText("(1)");
    await expect(preview.getByTestId("preview-section-measurements")).toContainText("(1)");
    await expect(preview.getByTestId("preview-section-encounters")).toContainText("(1)");

    // Choosing documents warns, before the link exists, what it really means.
    await page.getByTestId("share-section-documents").check();
    await expect(preview.getByText(/every page of every document/)).toBeVisible();
    await page.close();
  });
});
