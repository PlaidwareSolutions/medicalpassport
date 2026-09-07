import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createFreshPatient, patientHeaders, type FreshPatient } from "./fresh-patient";

/**
 * Offline capture (docs_v2/05 §14, docs_v2/06 P5 + P3): with the network
 * gone, a blood pressure recorded on the diary and a document captured on
 * the "Add a document" screen are both saved on the phone and queued;
 * when the connection returns the queue replays through the REAL api —
 * `observation/create` via `/sync`, and the document via the same
 * create → upload → complete → process sequence the online path uses —
 * and both exist server-side, exactly once. Runs as its OWN user.
 *
 * Both screens are opened while still online (the app shell, its chunks
 * and the concept table are then on the phone), the browser context goes
 * offline, the two captures happen, and the context comes back online.
 */
const FIXTURE = join(__dirname, "../../api/test/fixtures/prescription-page-1.png");
const galleryInput = 'input[type="file"][multiple]';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

let patient: FreshPatient;

async function openAs(page: Page, path: string) {
  await page.context().addCookies((await patient.ctx.storageState()).cookies);
  await page.context().addInitScript((id) => {
    window.localStorage.setItem("medpass_locale", "en");
    window.localStorage.setItem("medpass_profile_id", id);
  }, patient.profileId);
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.beforeAll(async () => {
  patient = await createFreshPatient("offline-capture", "Offline Capture Test Patient");
});

test.afterAll(async () => {
  await patient?.dispose();
});

test("a reading and a document captured offline are queued, then exist via the API once back online", async ({ page, context }) => {
  test.setTimeout(180_000);
  const headers = patientHeaders(patient.profileId);

  // Online: both screens loaded and ready.
  await openAs(page, "/measurements/blood_pressure");
  await expect(page.getByRole("button", { name: "Add a reading" })).toBeVisible();

  const capture = await context.newPage();
  await capture.goto("/documents/new?kind=prescription");
  await capture.waitForLoadState("networkidle").catch(() => {});
  await expect(capture.getByRole("heading", { name: "Add a document" })).toBeVisible();
  await capture.setInputFiles(galleryInput, [FIXTURE]);
  await expect(capture.getByTestId("captured-page")).toHaveCount(1);

  // The line goes down.
  await context.setOffline(true);

  // A blood pressure on the diary: saved on the phone, not lost, not sent.
  await page.getByRole("button", { name: "Add a reading" }).click();
  await expect(page.getByTestId("observation-sheet")).toBeVisible();
  await page.getByLabel("Systolic — the upper number (mmHg)").fill("128");
  await page.getByLabel("Diastolic — the lower number (mmHg)").fill("82");
  await page.getByLabel("Pulse (optional)").fill("71");
  await page.getByRole("button", { name: "Save reading" }).click();
  await expect(page.getByTestId("observation-saved-offline")).toBeVisible();
  await expect(page.getByText("1 change waiting to sync")).toBeVisible();

  // The document: queued with its declared kind; the screen says so.
  await capture.getByRole("button", { name: "Send this page" }).click();
  await expect(capture.getByTestId("document-queued")).toBeVisible();
  await expect(capture.getByText("Saved on this phone")).toBeVisible();

  // Nothing reached the server while offline.
  const beforeObs = await patient.ctx.get("/v1/profiles/current/observations", { headers });
  expect(((await beforeObs.json()) as { items: unknown[] }).items).toHaveLength(0);
  const beforeDocs = await patient.ctx.get("/v1/profiles/current/patient-documents", { headers });
  expect(((await beforeDocs.json()) as { items: unknown[] }).items).toHaveLength(0);

  // Back online: one engine flushes the shared queue (docs/32: "retry on
  // reopen" is the mandated fallback, so a reload is exactly the real path).
  await capture.close();
  await context.setOffline(false);
  // The `online` event may already have started a flush; a reload racing
  // it can be aborted by the browser — the real path is "reopen", so open
  // the diary again either way.
  await page.reload().catch(() => page.goto("/measurements/blood_pressure"));
  await page.waitForLoadState("networkidle").catch(() => {});

  // The reading exists once — as a BP row plus the pulse it carried.
  await expect
    .poll(
      async () => {
        const res = await patient.ctx.get("/v1/profiles/current/observations", { headers });
        const items = ((await res.json()) as { items: Array<{ concept: string; valueNumeric: string; valueNumeric2: string | null }> }).items;
        return items.map((o) => `${o.concept}:${o.valueNumeric}${o.valueNumeric2 ? "/" + o.valueNumeric2 : ""}`).sort();
      },
      { timeout: 60_000 },
    )
    .toEqual(["blood_pressure:128/82", "heart_rate:71"]);

  // The document exists once, whole, with the declared kind, and is on its way to the classifier.
  await expect
    .poll(
      async () => {
        const res = await patient.ctx.get("/v1/profiles/current/patient-documents", { headers });
        const items = ((await res.json()) as { items: Array<{ kind: string; status: string; pageCount: number }> }).items;
        return items.map((d) => `${d.kind}:${d.pageCount}:${["uploaded", "processing", "processed"].includes(d.status) ? "whole" : d.status}`);
      },
      { timeout: 60_000 },
    )
    .toEqual(["prescription:1:whole"]);

  // The diary refreshed itself from the replay's change signal and the queue is empty.
  await expect(page.getByTestId("observation-row").filter({ has: page.getByText("128/82 mmHg") })).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByText(/changes? waiting to sync/)).toHaveCount(0);

  // Replaying is exactly-once: a second flush (another reload) adds nothing.
  await page.reload().catch(() => page.goto("/measurements/blood_pressure"));
  await page.waitForLoadState("networkidle").catch(() => {});
  const afterObs = await patient.ctx.get("/v1/profiles/current/observations", { headers });
  expect(((await afterObs.json()) as { items: unknown[] }).items).toHaveLength(2);
  const afterDocs = await patient.ctx.get("/v1/profiles/current/patient-documents", { headers });
  expect(((await afterDocs.json()) as { items: unknown[] }).items).toHaveLength(1);
});
