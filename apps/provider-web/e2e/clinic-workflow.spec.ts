import { randomUUID } from "node:crypto";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { disconnectPrisma } from "@medpass/database";
import { clearConsumedOtps, seedDevOrganization } from "../scripts/seed-dev-org";

/**
 * The P11-4 exit-gate scenario end to end, against the real API (:4102)
 * and the built portal (:3102): seed a clinic owner, sign in with the
 * fixed dev OTP, redeem an onboarding token the patient minted (step-up),
 * send a reconciliation with one STOP and one START, see it awaiting the
 * patient's acceptance, accept it as the patient, and see the status flip.
 */
const API_URL = process.env.E2E_API_URL ?? `http://localhost:${process.env.E2E_API_PORT ?? "4102"}`;
const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

const randomPhone = () => "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");

async function ok(res: { ok(): boolean; status(): number; text(): Promise<string> }, what: string) {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
}

interface PatientFixture {
  api: APIRequestContext;
  profileId: string;
  headers: Record<string, string>;
  onboardingToken: string;
  medicationIds: { metformin: string; atorvastatin: string };
}

/** Patient side through the patient API only (no patient-web involved). */
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

  const medication = async (enteredName: string) => {
    const res = await api.post("/v1/profiles/current/medications", {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: { enteredName, source: "manual", quantityOnHand: 10, instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } },
    });
    await ok(res, `medication ${enteredName}`);
    return ((await res.json()) as { id: string }).id;
  };
  const metformin = await medication("Metformin 500");
  const atorvastatin = await medication("Atorvastatin 10");

  // Minting the onboarding token is a step-up operation (docs_v2/11 §7). The
  // login code was sent seconds ago; the resend cooldown counts it too.
  await clearConsumedOtps(phone);
  await ok(await api.post("/v1/auth/step-up"), "step-up request");
  await ok(await api.post("/v1/auth/step-up/verify", { data: { code: CODE } }), "step-up verify");
  const minted = await api.post("/v1/profiles/current/onboarding-tokens", {
    headers,
    data: { sections: ["medications", "allergies", "reports"], expiresIn: "1h", accessDays: 30 },
  });
  await ok(minted, "onboarding token");
  const onboardingToken = ((await minted.json()) as { token: string }).token;

  return { api, profileId, headers, onboardingToken, medicationIds: { metformin, atorvastatin } };
}

test.afterAll(async () => {
  await disconnectPrisma();
});

test("clinic workflow: QR onboarding, reconciliation with one STOP and one START, patient acceptance flips the status", async ({ page }) => {
  const clinicPhone = randomPhone();
  const patientPhone = randomPhone();
  await seedDevOrganization({ kind: "clinic", displayName: "Sunrise Clinic (e2e)", ownerPhone: clinicPhone });
  const patient = await preparePatient(patientPhone);

  // ── Sign in (phone → fixed dev code) ───────────────────────────────────
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(clinicPhone);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(CODE);
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Patients" })).toBeVisible();
  await expect(page.getByText("Sunrise Clinic (e2e)")).toBeVisible();
  await expect(page.getByText("Clinic mode:")).toBeVisible();

  // ── Add the patient with the onboarding token (paste fallback) ─────────
  await page.getByTestId("add-patient").click();
  await expect(page.getByRole("heading", { name: "Add a patient" })).toBeVisible();
  await page.getByTestId("onboarding-token").fill(patient.onboardingToken);
  await page.getByTestId("redeem-token").click();
  await expect(page).toHaveURL(/\/patients\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("patient-name")).toContainText("Ravi Kumar");
  await expect(page.getByTestId("snapshot-medications")).toContainText("Metformin 500");
  await expect(page.getByTestId("snapshot-medications")).toContainText("Atorvastatin 10");
  // A clinic is offered exactly its kinds — no discharge, dispense or report.
  await expect(page.getByTestId("action-reconciliation")).toBeVisible();
  await expect(page.getByTestId("action-prescription")).toBeVisible();
  await expect(page.getByTestId("action-encounter")).toBeVisible();
  await expect(page.getByTestId("action-discharge_transition")).toHaveCount(0);
  await expect(page.getByTestId("action-dispense")).toHaveCount(0);
  await expect(page.getByTestId("action-diagnostic_report")).toHaveCount(0);
  // The URL carries only the opaque link id — never the token or a name.
  expect(page.url()).not.toContain(patient.onboardingToken);

  // ── Reconciliation: STOP atorvastatin, START amlodipine ────────────────
  await page.getByTestId("action-reconciliation").click();
  await expect(page.getByRole("heading", { name: "Reconcile medicines" })).toBeVisible();
  await expect(page.getByText("This is the patient's own record.")).toBeVisible();

  await page.getByRole("radiogroup", { name: "Decision: Atorvastatin 10" }).getByRole("radio", { name: /^Stop/ }).click();
  await page.getByLabel("Why stop Atorvastatin 10 (optional)").fill("LDL at target");

  await page.getByTestId("add-medicine").click();
  await page.getByLabel("Medicine name (new medicine 1)").fill("Amlodipine 5");
  await page.getByRole("radiogroup", { name: "Amlodipine 5: how much each time" }).getByRole("radio", { name: "1", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Amlodipine 5: form" }).getByRole("radio", { name: "Tablet", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Amlodipine 5: how often" }).getByRole("radio", { name: "Once a day (morning)" }).click();
  await page.getByRole("radiogroup", { name: "Amlodipine 5: with food" }).getByRole("radio", { name: "After food" }).click();

  // Review step: STOP lines visibly apart; metformin (undecided) stays unchanged.
  await page.getByTestId("review-proposal").click();
  await expect(page.getByTestId("transition-review")).toBeVisible();
  await expect(page.getByTestId("review-stopped")).toContainText("STOP · Atorvastatin 10");
  await expect(page.getByTestId("review-stopped")).toContainText("LDL at target");
  await expect(page.getByTestId("transition-review")).toContainText("Amlodipine 5");
  await expect(page.getByTestId("transition-review")).toContainText("START · 1 tablet · Once a day (morning) · After food");
  await expect(page.getByTestId("transition-review")).toContainText("Not discussed — unchanged");
  await expect(page.getByTestId("transition-review")).toContainText("Metformin 500");

  // Send → awaiting the patient's acceptance.
  await page.getByTestId("send-proposal").click();
  await expect(page.getByTestId("awaiting-acceptance")).toBeVisible();
  await expect(page.getByTestId("proposal-status")).toHaveAttribute("data-status", "proposed");
  await expect(page.getByTestId("proposal-status")).toContainText("Awaiting the patient's acceptance");
  const viewLink = page.getByRole("link", { name: "View this proposal" });
  const proposalHref = await viewLink.getAttribute("href");
  expect(proposalHref).toMatch(/^\/proposals\/[0-9a-f-]{36}$/);
  const proposalId = proposalHref!.split("/").pop()!;

  // Nothing clinical changed yet: the patient's atorvastatin is still current.
  const stillCurrent = await patient.api.get(`/v1/medications/${patient.medicationIds.atorvastatin}`, { headers: patient.headers });
  await ok(stillCurrent, "medication read");
  expect(((await stillCurrent.json()) as { status: string }).status).toBe("current");

  // The patient sees it in their inbox with the two lines, and accepts (step-up is still fresh).
  const inbox = await patient.api.get("/v1/profiles/current/proposals?status=proposed", { headers: patient.headers });
  await ok(inbox, "patient inbox");
  const inboxItems = ((await inbox.json()) as { items: Array<{ id: string; payload: { lines: Array<{ decision: string }> } }> }).items;
  const mine = inboxItems.find((p) => p.id === proposalId);
  expect(mine?.payload.lines.map((l) => l.decision).sort()).toEqual(["START", "STOP"]);

  const accepted = await patient.api.post(`/v1/proposals/${proposalId}/accept`, { headers: patient.headers, data: {} });
  await ok(accepted, "accept proposal");
  expect(((await accepted.json()) as { status: string; applied: { started: number; stopped: number } })).toMatchObject({ status: "accepted", applied: { started: 1, stopped: 1 } });

  // ── The provider sees the status flip ──────────────────────────────────
  await viewLink.click();
  await expect(page).toHaveURL(new RegExp(`/proposals/${proposalId}$`));
  await expect(page.getByTestId("proposal-status")).toHaveAttribute("data-status", "accepted");
  await expect(page.getByText("The patient accepted this.")).toBeVisible();

  await page.getByRole("link", { name: "← Back to the patient" }).click();
  await expect(page.getByTestId("proposals-list")).toContainText("Medicine reconciliation");
  await expect(page.getByTestId("proposals-list").getByTestId("proposal-status")).toHaveAttribute("data-status", "accepted");
  // And the shared record reflects the accepted lines.
  await expect(page.getByTestId("snapshot-medications")).toContainText("Amlodipine 5");
  await expect(page.getByTestId("snapshot-medications")).not.toContainText("Atorvastatin 10");

  await patient.api.dispose();
});
