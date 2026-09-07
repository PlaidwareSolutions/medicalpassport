import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { disconnectPrisma } from "@medpass/database";
import { clearConsumedOtps, seedDevOrganization } from "../scripts/seed-dev-org";

/**
 * What the portal actually says, once a proposal has been sent and decided
 * (2026-09-07 portal QA). Every assertion here is a sentence a clinician
 * reads on the screen: the medicine a line is about, which line the patient
 * refused, an analyte's name rather than its storage key, a follow-up date
 * without a meaningless midnight, the same instruction labels on a CONTINUE
 * line as on a START line, a 404 that fits what was being opened, a Save
 * button that agrees with the error under the field, two links from the
 * same patient told apart, and none of it clipped at 390px.
 */
const API_URL = process.env.E2E_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? "4102"}`;
const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
const PHONE_390 = { width: 390, height: 844 };

const randomPhone = () => "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

async function ok(res: { ok(): boolean; status(): number; text(): Promise<string> }, what: string) {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
}

interface PatientFixture {
  api: APIRequestContext;
  profileId: string;
  headers: Record<string, string>;
  medicationIds: { metformin: string; atorvastatin: string };
  /** Mint another onboarding token whenever the test needs one. */
  mintToken: (sections: string[]) => Promise<string>;
  /** Re-verify for the step-up operations (minting a token, accepting a proposal). */
  stepUp: () => Promise<void>;
}

/** Patient side through the patient API only — no patient-web involved. */
async function preparePatient(phone: string): Promise<PatientFixture> {
  const anon = await playwrightRequest.newContext({ baseURL: API_URL, extraHTTPHeaders: { "x-requested-with": "medpass" } });
  await ok(await anon.post("/v1/auth/otp/request", { data: { phone } }), "patient otp/request");
  const verified = await anon.post("/v1/auth/otp/verify", { data: { phone, code: CODE, device: { kind: "browser" }, locale: "en" } });
  await ok(verified, "patient otp/verify");
  const token = ((await verified.json()) as { token: string }).token;
  await anon.dispose();

  const api = await playwrightRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { "x-requested-with": "medpass", authorization: `Bearer ${token}` },
  });
  const profileRes = await api.post("/v1/profiles", { data: { displayName: "Ravi Kumar", yearOfBirth: 1960, preferredLocale: "en" } });
  await ok(profileRes, "profile create");
  const profileId = ((await profileRes.json()) as { id: string }).id;
  const headers = { "x-profile-id": profileId };

  const medication = async (enteredName: string, instruction: object) => {
    const res = await api.post("/v1/profiles/current/medications", {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: { enteredName, source: "manual", quantityOnHand: 10, instruction },
    });
    await ok(res, `medication ${enteredName}`);
    return ((await res.json()) as { id: string }).id;
  };
  const metformin = await medication("Metformin 500", { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", foodInstruction: "after" });
  const atorvastatin = await medication("Atorvastatin 10", { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "HS" });

  // Minting a token and accepting a proposal are both step-up operations
  // (docs_v2/11 §7); the resend cooldown counts the login code too.
  const stepUp = async () => {
    await clearConsumedOtps(phone);
    await ok(await api.post("/v1/auth/step-up"), "step-up request");
    await ok(await api.post("/v1/auth/step-up/verify", { data: { code: CODE } }), "step-up verify");
  };

  const mintToken = async (sections: string[]) => {
    await stepUp();
    const minted = await api.post("/v1/profiles/current/onboarding-tokens", { headers, data: { sections, expiresIn: "1h", accessDays: 30 } });
    await ok(minted, "onboarding token");
    return ((await minted.json()) as { token: string }).token;
  };

  return { api, profileId, headers, medicationIds: { metformin, atorvastatin }, mintToken, stepUp };
}

async function signIn(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(CODE);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
}

/** Redeems an onboarding token through the portal's own paste fallback and returns the link id. */
async function addPatient(page: Page, token: string): Promise<string> {
  await page.goto("/patients/add");
  await page.getByTestId("onboarding-token").fill(token);
  await page.getByTestId("redeem-token").click();
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test.afterAll(async () => {
  await disconnectPrisma();
});

test("a decided proposal names its medicines, its analytes and its dates, and says what the patient refused", async ({ page }) => {
  const clinicPhone = randomPhone();
  const patientPhone = randomPhone();
  await seedDevOrganization({ kind: "clinic", displayName: "Fidelity Clinic (e2e)", ownerPhone: clinicPhone });
  const patient = await preparePatient(patientPhone);
  const firstToken = await patient.mintToken(["medications", "allergies"]);
  const secondToken = await patient.mintToken(["medications", "allergies", "bloodPressureReadings"]);

  await signIn(page, clinicPhone);
  await expect(page.getByRole("heading", { name: "Patients" })).toBeVisible();

  // ── Two codes from the same patient are told apart ─────────────────────
  const firstLink = await addPatient(page, firstToken);
  await addPatient(page, secondToken);
  await page.goto("/");
  const rows = page.getByTestId("patients-list").getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("duplicate-link-note").first()).toContainText("Code 1 of 2");
  await expect(page.getByTestId("duplicate-link-note").nth(1)).toContainText("Code 2 of 2");
  // …and by what each one actually shares, not by a bare count.
  await expect(page.getByTestId("patients-list")).toContainText("Shares Current medicines, Allergies · access until");
  await expect(page.getByTestId("patients-list")).toContainText("Blood pressure");

  // ── A CONTINUE line is written the way a START line is ─────────────────
  await page.goto(`/patients/${firstLink}/reconciliation`);
  await expect(page.getByRole("heading", { name: "Reconcile medicines" })).toBeVisible();
  // The shared payload's shorthand ("1 tablet · BD · after") never reaches the screen.
  await expect(page.getByTestId(`line-${patient.medicationIds.metformin}`)).toContainText("Now: 1 tablet · Twice a day · After food");
  await expect(page.getByTestId(`line-${patient.medicationIds.metformin}`)).not.toContainText("BD");

  await page.getByRole("radiogroup", { name: "Decision: Metformin 500" }).getByRole("radio", { name: /^Continue/ }).click();
  await page.getByRole("radiogroup", { name: "Decision: Atorvastatin 10" }).getByRole("radio", { name: /^Stop/ }).click();
  await page.getByLabel("Why stop Atorvastatin 10 (optional)").fill("LDL at target");
  await page.getByTestId("review-proposal").click();
  await expect(page.getByTestId("transition-review")).toContainText("CONTINUE · 1 tablet · Twice a day · After food");

  await page.getByTestId("send-proposal").click();
  const proposalHref = await page.getByRole("link", { name: "View this proposal" }).getAttribute("href");
  const proposalId = proposalHref!.split("/").pop()!;

  // ── The patient accepts the CONTINUE line and refuses the STOP ─────────
  const inbox = await patient.api.get(`/v1/proposals/${proposalId}`, { headers: patient.headers });
  await ok(inbox, "patient reads the proposal");
  const lines = ((await inbox.json()) as { payload: { lines: Array<{ decision: string; proposedName: string }> } }).payload.lines;
  // Every line names its medicine, including the ones that only refer to an existing id.
  expect(lines.map((l) => `${l.decision}:${l.proposedName}`).sort()).toEqual(["CONTINUE:Metformin 500", "STOP:Atorvastatin 10"]);
  const stopIndex = lines.findIndex((l) => l.decision === "STOP");
  await patient.stepUp();
  await ok(
    await patient.api.post(`/v1/proposals/${proposalId}/accept`, { headers: patient.headers, data: { declinedLines: [stopIndex] } }),
    "accept with one line declined",
  );

  // ── The clinic sees which line was refused, and on which medicine ──────
  await page.goto(`/proposals/${proposalId}`);
  await expect(page.getByTestId("proposal-status")).toHaveAttribute("data-status", "accepted");
  await expect(page.getByTestId("proposal-decision")).toContainText("accepted 1 of 2 lines and said no to one");
  await expect(page.getByTestId("proposal-line").filter({ hasText: "STOP · Atorvastatin 10" })).toContainText("The patient said no to this line");
  await expect(page.getByTestId("proposal-line").filter({ hasText: "CONTINUE · Metformin 500" })).toBeVisible();
  // "medicine on the patient's list" was the old placeholder — it is gone.
  await expect(page.getByText(/medicine on the patient.s list/i)).toHaveCount(0);

  // ── A follow-up is a day, not a moment ─────────────────────────────────
  await page.goto(`/patients/${firstLink}/encounter`);
  await page.getByLabel("Follow-up on (optional)").fill("2026-09-14");
  await page.getByRole("button", { name: "Send to the patient" }).click();
  const encounterHref = await page.getByRole("link", { name: "View this proposal" }).getAttribute("href");
  await page.goto(encounterHref!);
  // A day, in whatever order this browser's locale writes one — and never a clock.
  const followUp = page.getByText(/^Follow-up /);
  await expect(followUp).toContainText("14");
  await expect(followUp).toContainText("2026");
  await expect(followUp).not.toContainText(":");

  // ── A rejection carries the patient's reason back ──────────────────────
  const encounterId = encounterHref!.split("/").pop()!;
  await ok(
    await patient.api.post(`/v1/proposals/${encounterId}/reject`, { headers: patient.headers, data: { reason: "That was not my appointment" } }),
    "reject with a reason",
  );
  await page.reload();
  await expect(page.getByTestId("proposal-decision")).toContainText("That was not my appointment");

  // ── An unknown proposal id does not blame the patient's link ───────────
  await page.goto(`/proposals/${randomUUID()}`);
  await expect(page.getByText("This proposal does not exist")).toBeVisible();
  await expect(page.getByText("no longer open")).toHaveCount(0);

  await patient.api.dispose();
});

test("a sent report reads its analyte names, not their storage keys", async ({ page }) => {
  const labPhone = randomPhone();
  const patientPhone = randomPhone();
  await seedDevOrganization({ kind: "laboratory", displayName: "City Diagnostics (e2e)", ownerPhone: labPhone });
  const patient = await preparePatient(patientPhone);
  const token = await patient.mintToken(["reports"]);

  await signIn(page, labPhone);
  await expect(page.getByRole("heading", { name: "Patients" })).toBeVisible();
  const linkId = await addPatient(page, token);

  await page.goto(`/patients/${linkId}/diagnostic-report`);
  await page.getByLabel("Report title").fill("Diabetes panel");
  await page.getByLabel("Row 1: test").selectOption("hba1c");
  await page.getByLabel("Row 1: value as printed").fill("6.9");
  await page.getByLabel("Row 1: unit as printed").selectOption("%");
  await page.getByRole("button", { name: "Review before sending" }).click();
  await page.getByRole("button", { name: "Send to the patient" }).click();

  const href = await page.getByRole("link", { name: "View this proposal" }).getAttribute("href");
  await page.goto(href!);
  // Case matters here: "hba1c" is the storage key, "HbA1c" is the analyte's
  // name, and getByText would happily match one for the other.
  await expect(page.getByRole("listitem").filter({ hasText: "6.9" })).toHaveText(/^HbA1c: 6\.9 %$/);

  await patient.api.dispose();
});

test("at 390px every choice is readable and the members table admits it scrolls", async ({ page }) => {
  const clinicPhone = randomPhone();
  const patientPhone = randomPhone();
  await seedDevOrganization({ kind: "clinic", displayName: "Narrow Clinic (e2e)", ownerPhone: clinicPhone });
  const patient = await preparePatient(patientPhone);
  const token = await patient.mintToken(["medications"]);

  await page.setViewportSize(PHONE_390);
  await signIn(page, clinicPhone);
  await expect(page.getByRole("heading", { name: "Patients" })).toBeVisible();
  const linkId = await addPatient(page, token);

  // ── Pickers: the label a choice carries is the label you can read ──────
  await page.goto(`/patients/${linkId}/reconciliation`);
  await page.getByTestId("add-medicine").click();
  await page.getByLabel("Medicine name (new medicine 1)").fill("Insulin glargine");

  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    for (const button of document.querySelectorAll<HTMLElement>('[role="radio"]')) {
      const label = button.firstElementChild as HTMLElement | null;
      // A label whose text is wider than the box drawn for it is cut off.
      if (label && label.scrollWidth > label.clientWidth + 1) out.push(label.textContent ?? "");
      if (button.scrollWidth > button.clientWidth + 1) out.push(button.textContent ?? "");
    }
    return out;
  });
  expect(clipped).toEqual([]);
  // The four the QA pass named are all present and whole.
  for (const label of ["Unit (injection)", "Before food", "At bedtime", "Ongoing"]) {
    await expect(page.getByRole("radio", { name: label, exact: true }).first()).toBeVisible();
  }
  // And nothing pushes the page itself sideways.
  const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(bodyOverflow).toBeLessThanOrEqual(1);

  // ── Organization: Save agrees with the error under the field ───────────
  await page.goto("/organization");
  const save = page.getByTestId("save-organization");
  await expect(save).toBeEnabled();
  await page.getByLabel("Organization phone").fill("98000");
  await expect(page.getByText("With country code, e.g. +91…")).toBeVisible();
  await expect(save).toBeDisabled();
  await page.getByLabel("Organization phone").fill("+919800000031");
  await expect(save).toBeEnabled();

  // ── Members: the table says it goes further than the screen ────────────
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await expect(page.getByTestId("table-scroll-hint")).toBeVisible();

  await patient.api.dispose();
});
