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
  const patientName = "Scope Probe Patient";

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

    // Choosing documents warns, before the link exists, what it really means.
    await page.getByTestId("share-section-documents").check();
    await expect(preview.getByText(/every page of every document/)).toBeVisible();
    await page.close();
  });
});
