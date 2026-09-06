import { expect, request, test, type Browser, type Page } from "@playwright/test";
import { API, OTP_CODE, apiPrisma, createFreshPatient, patientHeaders, phoneDigest, resetOtpRateLimits, type FreshPatient } from "./fresh-patient";

/**
 * The proposals inbox end to end (docs_v2/06 P11-5, ADR-V2-009), against a
 * real clinic seeded the way `apps/api/test/provider-proposals.e2e-spec.ts`
 * seeds one: the organization and its owner go straight into the database
 * (there is no self-serve organization API), then every step after that
 * runs through the real routes and the real screens.
 *
 * What it pins: a clinic's reconciliation reaches the patient as a request,
 * not an event; the four decisions are four distinct groups; a STOP line
 * never renders as something being added (H-34); a single line can be
 * declined while the rest are accepted (H-43); and after acceptance only
 * the accepted lines have touched the record.
 */
test.describe.configure({ mode: "serial" });

let patient: FreshPatient;
let metforminId: string;
let atorvastatinId: string;
let providerToken: string;
let linkId: string;
let proposalId: string;
const CLINIC_NAME = "Sunrise Clinic";

/** Signs a phone in as a patient (which creates the user row), then makes it a clinic owner. */
async function seedClinicOwner(phone: string): Promise<void> {
  const db = apiPrisma();
  await resetOtpRateLimits();
  const ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { "x-requested-with": "medpass" } });
  await ctx.post("/v1/auth/otp/request", { data: { phone } });
  const verified = await ctx.post("/v1/auth/otp/verify", { data: { phone, code: OTP_CODE, device: { kind: "browser" } } });
  expect(verified.ok(), `provider user sign-in: ${verified.status()} ${await verified.text()}`).toBe(true);
  await ctx.dispose();

  const user = await db.user.findUnique({ where: { phoneDigest: phoneDigest(phone) } });
  if (!user) throw new Error("could not find the freshly created provider user");
  await db.user.update({ where: { id: user.id }, data: { userKind: "both" } });
  const organization = await db.organization.create({ data: { kind: "clinic", displayName: CLINIC_NAME } });
  await db.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "owner" } });
}

async function providerSignIn(phone: string): Promise<string> {
  const db = apiPrisma();
  await resetOtpRateLimits();
  // The provider login OTP and the sign-in OTP above share this number's
  // 30 s cooldown; drop this number's attempts rather than waiting it out.
  await db.otpAttempt.deleteMany({ where: { phoneDigest: phoneDigest(phone) } });
  const ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { "x-requested-with": "medpass" } });
  const login = await ctx.post("/v1/provider/auth/login", { data: { phone } });
  expect(login.ok(), `provider login: ${login.status()} ${await login.text()}`).toBe(true);
  const totp = await ctx.post("/v1/provider/auth/totp", { data: { phone, code: OTP_CODE } });
  expect(totp.ok(), `provider totp: ${totp.status()} ${await totp.text()}`).toBe(true);
  const token = ((await totp.json()) as { token: string }).token;
  await ctx.dispose();
  return token;
}

async function providerCtx() {
  return request.newContext({
    baseURL: API,
    extraHTTPHeaders: { "x-requested-with": "medpass", authorization: `Bearer ${providerToken}` },
  });
}

async function medications(): Promise<Array<{ id: string; enteredName: string; status: string }>> {
  const res = await patient.ctx.get("/v1/profiles/current/medications", { headers: patientHeaders(patient.profileId) });
  expect(res.ok(), `medications list: ${res.status()}`).toBe(true);
  return ((await res.json()) as { items: Array<{ id: string; enteredName: string; status: string }> }).items;
}

async function openInbox(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: patient.storageState });
  const page = await context.newPage();
  await page.goto("/proposals");
  return page;
}

test.beforeAll(async () => {
  // One OTP cooldown (~31 s) is waited out for the step-up below.
  test.setTimeout(180_000);
  patient = await createFreshPatient("proposals", "Proposals Test Patient");

  const addMedicine = async (enteredName: string) => {
    const res = await patient.ctx.post("/v1/profiles/current/medications", {
      headers: { ...patientHeaders(patient.profileId), "idempotency-key": crypto.randomUUID() },
      data: { enteredName, source: "manual", quantityOnHand: 30, instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } },
    });
    expect(res.ok(), `medication create: ${res.status()} ${await res.text()}`).toBe(true);
    return ((await res.json()) as { id: string }).id;
  };
  metforminId = await addMedicine("Metformin 500");
  atorvastatinId = await addMedicine("Atorvastatin 10");

  const providerPhone = "+9197" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  await seedClinicOwner(providerPhone);
  providerToken = await providerSignIn(providerPhone);

  // Minting the onboarding token is step-up guarded; the sheet itself is
  // covered by step-up.spec.ts, so this spec re-verifies over the API and
  // keeps the browser on the screens under test.
  await patient.stepUp();
  const minted = await patient.ctx.post("/v1/profiles/current/onboarding-tokens", {
    headers: patientHeaders(patient.profileId),
    data: { sections: ["medications", "allergies"], expiresIn: "1h", accessDays: 30 },
  });
  expect(minted.ok(), `mint onboarding token: ${minted.status()} ${await minted.text()}`).toBe(true);
  const qrToken = ((await minted.json()) as { token: string }).token;

  const provider = await providerCtx();
  const onboarded = await provider.post("/v1/provider/patients/onboard", { data: { qrToken } });
  expect(onboarded.ok(), `provider onboard: ${onboarded.status()} ${await onboarded.text()}`).toBe(true);
  linkId = ((await onboarded.json()) as { linkId: string }).linkId;

  // START / CONTINUE / STOP in one reconciliation — the shape H-34 and
  // H-43 are about.
  const proposed = await provider.post(`/v1/provider/patients/${linkId}/reconciliations`, {
    data: {
      notes: "Annual review",
      practitionerName: "Dr Mehta",
      lines: [
        { decision: "START", proposedName: "Amlodipine 5", proposedInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } },
        { decision: "CONTINUE", patientMedicationId: metforminId },
        { decision: "STOP", patientMedicationId: atorvastatinId, reasonText: "LDL at target" },
      ],
    },
  });
  expect(proposed.ok(), `propose reconciliation: ${proposed.status()} ${await proposed.text()}`).toBe(true);
  proposalId = ((await proposed.json()) as { id: string }).id;
  await provider.dispose();
});

test.afterAll(async () => {
  await patient?.dispose();
  await apiPrisma().$disconnect();
});

test("the inbox names the clinic and what it would change, and nothing is applied yet", async ({ browser }) => {
  const page = await openInbox(browser);

  await expect(page.getByRole("heading", { name: "Waiting for your answer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: CLINIC_NAME })).toBeVisible();

  const row = page.getByTestId("proposal-row");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-kind", "reconciliation");
  await expect(row).toContainText("Changes to your medicines");
  await expect(row).toContainText("1 to start");
  await expect(row).toContainText("1 to keep taking");
  await expect(row).toContainText("1 to stop");

  // Still a request, not an event: the clinical tables are untouched.
  const meds = await medications();
  expect(meds.map((m) => m.enteredName).sort()).toEqual(["Atorvastatin 10", "Metformin 500"]);
  expect(meds.every((m) => m.status === "current")).toBe(true);

  await page.context().close();
});

test("the four decisions are four groups and a STOP line is never drawn as an add (H-34)", async ({ browser }) => {
  const context = await browser.newContext({ storageState: patient.storageState });
  const page = await context.newPage();
  await page.goto(`/proposals/${proposalId}`);

  await expect(page.getByTestId("proposal-source")).toContainText(CLINIC_NAME);
  await expect(page.getByText("Nothing has changed in your record yet.")).toBeVisible();

  const groups = page.getByTestId("decision-group");
  await expect(groups).toHaveCount(3); // no CHANGE line in this proposal
  await expect(page.getByRole("heading", { name: "Start taking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Keep taking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stop taking" })).toBeVisible();

  const stopLine = page.locator('[data-testid="proposal-line"][data-decision="STOP"]');
  await expect(stopLine).toHaveCount(1);
  await expect(stopLine).toContainText("Stop taking Atorvastatin 10");
  await expect(stopLine).toContainText("LDL at target");
  // H-34: no dose, no frequency, nothing that reads as an instruction to take it.
  await expect(stopLine.getByTestId("proposal-line-instruction")).toHaveCount(0);
  await expect(stopLine).not.toContainText("Once a day");

  // H-34's second half: the transition is never one yes/no while its lines
  // can be declined — every line carries its own pair of buttons.
  await expect(page.getByTestId("proposal-line")).toHaveCount(3);
  await expect(page.getByTestId("decline-line")).toHaveCount(3);

  // The START line does show what would be taken, and says so as a start.
  const startLine = page.locator('[data-testid="proposal-line"][data-decision="START"]');
  await expect(startLine).toContainText("Start taking Amlodipine 5");
  await expect(startLine.getByTestId("proposal-line-instruction")).toContainText("Once a day");

  await context.close();
});

test("declining one line accepts the rest, and only those took effect (H-43)", async ({ browser }) => {
  const context = await browser.newContext({ storageState: patient.storageState });
  const page = await context.newPage();
  await page.goto(`/proposals/${proposalId}`);

  const stopLine = page.locator('[data-testid="proposal-line"][data-decision="STOP"]');
  await stopLine.getByTestId("decline-line").click();
  await expect(stopLine).toHaveAttribute("data-declined", "true");
  await expect(page.getByText("Saying yes to 2 of 3")).toBeVisible();
  await expect(page.getByText("1 skipped")).toBeVisible();

  await page.getByTestId("accept-proposal").click();
  await expect(page.getByTestId("proposal-accepted")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Added to your record")).toBeVisible();

  const meds = await medications();
  const byName = (name: string) => meds.find((m) => m.enteredName === name);

  // START accepted → the medicine now exists.
  expect(byName("Amlodipine 5")?.status).toBe("current");
  // CONTINUE accepted → unchanged, still current.
  expect(byName("Metformin 500")?.status).toBe("current");
  expect(byName("Metformin 500")?.id).toBe(metforminId);
  // STOP declined → the medicine was NOT stopped. This is the whole point
  // of per-line confirmation: one refused line changes nothing else.
  expect(byName("Atorvastatin 10")?.id).toBe(atorvastatinId);
  expect(byName("Atorvastatin 10")?.status).toBe("current");

  // And the proposal has left the inbox.
  await page.goto("/proposals");
  await expect(page.getByTestId("proposal-row")).toHaveCount(0);
  await expect(page.getByText("Nothing is waiting")).toBeVisible();

  await context.close();
});
