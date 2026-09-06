// Populates a demo patient through the real API on :4000, drives the clinic
// side, then signs in as that patient in a real browser against :3000 and
// screenshots every V2 screen. Leaves the data in place so the same phone
// number can be used to explore the app by hand.
//
//   node apps/patient-web/scripts/ui-walkthrough.mjs
//
// Needs the API on :4000, the worker, the patient app on :3000 and a seeded
// clinic (+919000000001). Prints the phone numbers to sign in with at the end.
//
// Local dev only. Uses the fixed dev OTP (000000) and the seeded clinic
// (+919000000001, see `pnpm --filter @medpass/provider-web seed:dev-org`).
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");

const require = createRequire(resolve(REPO, "apps/patient-web/package.json"));
const { chromium } = require("@playwright/test");

const API = process.env.API_URL ?? "http://localhost:4000";
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const OUT = resolve(REPO, ".dev-data/ui-walkthrough");
const CODE = "000000";
const PATIENT = { phone: "+9198765" + String(Math.floor(Math.random() * 1e5)).padStart(5, "0"), name: "Asha Rao", yob: 1968 };
const CAREGIVER = { phone: "+9198766" + String(Math.floor(Math.random() * 1e5)).padStart(5, "0"), name: "Ravi Rao" };
const CLINIC_PHONE = "+919000000001";
const FIXTURE = resolve(REPO, "apps/api/test/fixtures/prescription-page-1.png");

mkdirSync(OUT, { recursive: true });
const report = [];
const step = async (name, fn) => {
  try {
    const out = await fn();
    report.push({ name, ok: true, note: typeof out === "string" ? out : "" });
    console.log(`ok    ${name}${typeof out === "string" ? " — " + out : ""}`);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report.push({ name, ok: false, note: msg.slice(0, 160) });
    console.log(`FAIL  ${name} — ${msg.slice(0, 200)}`);
    return undefined;
  }
};

// ---------- tiny API client ----------
async function api(method, path, { token, profileId, body, orgId } = {}) {
  const headers = { "x-requested-with": "medpass", "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (profileId) headers["x-profile-id"] = profileId;
  if (orgId) headers["x-organization-id"] = orgId;
  if (method !== "GET") headers["idempotency-key"] = randomUUID();
  const res = await fetch(`${API}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${typeof json === "object" ? JSON.stringify(json).slice(0, 220) : String(json).slice(0, 220)}`);
  return json;
}
async function signIn(phone) {
  await api("POST", "/auth/otp/request", { body: { phone } });
  const v = await api("POST", "/auth/otp/verify", { body: { phone, code: CODE, device: { kind: "browser" }, locale: "en", rememberDevice: true } });
  return v.token;
}
// A step-up sends an OTP, and the API enforces 30 s between sends to one
// number — so wait out the window after sign-in, then step up exactly once
// (it stays fresh for 10 minutes, which covers every sensitive call below).
let steppedUp = false;
async function stepUp(token) {
  if (steppedUp) return;
  await new Promise((r) => setTimeout(r, 31_000));
  await api("POST", "/auth/step-up", { token });
  await api("POST", "/auth/step-up/verify", { token, body: { code: CODE } });
  steppedUp = true;
}
const today = new Date();
const daysAgo = (n, h = 8) => { const d = new Date(today); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const dateOnly = (n) => daysAgo(n).slice(0, 10);

// ---------- patient ----------
const patientToken = await step("patient signs in", () => signIn(PATIENT.phone));
let profileId;
await step("patient profile", async () => {
  const profiles = await api("GET", "/profiles", { token: patientToken });
  const existing = (profiles.items ?? profiles).find?.((p) => p.displayName === PATIENT.name);
  if (existing) { profileId = existing.id; return "reused"; }
  const p = await api("POST", "/profiles", { token: patientToken, body: { displayName: PATIENT.name, yearOfBirth: PATIENT.yob, preferredLocale: "en" } });
  profileId = p.id; return "created";
});
const P = { token: patientToken, profileId };

let conditionId;
await step("condition, allergy, visit", async () => {
  const c = await api("POST", "/profiles/current/conditions", { ...P, body: { label: "Type 2 diabetes mellitus", clinicalStatus: "active", onsetDate: "2019-03-10" } });
  conditionId = c.id;
  await api("POST", "/profiles/current/allergies", { ...P, body: { label: "Penicillin", severity: "severe", category: "medication", criticality: "high" } });
  await api("POST", "/profiles/current/encounters", { ...P, body: { kind: "outpatient", startedAt: daysAgo(20, 10), reasonText: "Diabetes review" } });
});

let metforminId, atorvastatinId;
await step("two medicines", async () => {
  const mk = (enteredName, pattern, reason) => api("POST", "/profiles/current/medications", { ...P, body: {
    enteredName, prescriberName: "Dr. Meera Iyer", patientReason: reason, source: "manual", quantityOnHand: 20,
    instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN", pattern, foodInstruction: "after" },
  } });
  metforminId = (await mk("Metformin 500", "1-0-1", "Type 2 diabetes")).id;
  atorvastatinId = (await mk("Atorvastatin 10", "0-0-1", "Cholesterol")).id;
});
await step("medicine links + refill plan", async () => {
  const m = await api("GET", `/medications/${metforminId}`, P);
  await api("PATCH", `/medications/${metforminId}`, { ...P, body: { rowVersion: m.rowVersion, reasonConditionId: conditionId, stopPlannedAt: dateOnly(-90) } });
  await api("PUT", `/medications/${metforminId}/refill-plan`, { ...P, body: { packSize: 30, quantityOnHand: 20 } });
});
let prescriptionId;
await step("prescription with line items", async () => {
  const rx = await api("POST", "/profiles/current/prescriptions", { ...P, body: {
    diagnosisText: "Type 2 diabetes, hypertension", validUntil: dateOnly(-60), followUpOn: dateOnly(-30),
    items: [
      { enteredName: "Metformin 500", doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", foodInstruction: "after", durationDays: 30 },
      { enteredName: "Telmisartan 40" },
    ],
  } });
  prescriptionId = rx.id;
});

let analyte;
await step("lab reports with HbA1c", async () => {
  const terms = await api("GET", "/terminology/analytes");
  const list = terms.items ?? terms.analytes ?? terms;
  analyte = list.find((a) => /hba1c/i.test(a.key)) ?? list[0];
  const unit = analyte.allowedEnteredUnits?.[0]?.unit ?? analyte.canonicalUnit ?? undefined;
  for (const [days, value] of [[95, "7.8"], [5, "7.2"]]) {
    const r = await api("POST", "/profiles/current/diagnostic-reports", { ...P, body: { kind: "laboratory", title: "HbA1c", testedAt: daysAgo(days), facilityNameText: "City Diagnostics" } });
    await api("POST", `/diagnostic-reports/${r.id}/results`, { ...P, body: { analyteKey: analyte.key, enteredValueText: value, ...(unit ? { enteredUnit: unit } : {}), referenceText: "4 - 5.6" } });
  }
  return `analyte ${analyte.key}`;
});
await step("measurements over three weeks", async () => {
  const bp = [[20, 148, 92], [14, 141, 88], [7, 136, 85], [1, 131, 82]];
  for (const [d, s, dia] of bp) await api("POST", "/profiles/current/observations", { ...P, body: { concept: "blood_pressure", valueNumeric: s, valueNumeric2: dia, measuredAt: daysAgo(d, 7) } });
  for (const [d, g] of [[10, 156], [3, 142]]) await api("POST", "/profiles/current/observations", { ...P, body: { concept: "blood_glucose", valueNumeric: g, measuredAt: daysAgo(d, 9) } });
  await api("POST", "/profiles/current/observations", { ...P, body: { concept: "body_weight", valueNumeric: 72.4, measuredAt: daysAgo(2, 7) } });
});
let documentId;
await step("scanned prescription photo (worker classifies it)", async () => {
  const bytes = readFileSync(FIXTURE);
  const created = await api("POST", "/profiles/current/patient-documents", { ...P, body: { kind: "prescription", sourceChannel: "gallery", pages: [{ contentType: "image/png", sizeBytes: bytes.length }] } });
  documentId = created.id;
  const auth = created.pages[0];
  const put = await fetch(auth.uploadUrl, { method: "PUT", headers: { "content-type": "image/png" }, body: bytes });
  if (!put.ok) throw new Error(`upload PUT ${put.status}`);
  await api("POST", `/patient-documents/${documentId}/pages/${auth.pageNumber}/complete`, P);
});
await step("share link for a doctor (24h)", async () => {
  await stepUp(patientToken);
  const s = await api("POST", "/profiles/current/shares", { ...P, body: { sections: { measurements: true, documents: true }, expiresIn: "24h", audience: "doctor" } });
  return `${WEB}/s/${s.token ?? s.publicToken ?? "?"}`;
});

// ---------- caregiver ----------
const caregiverToken = await step("caregiver signs in", () => signIn(CAREGIVER.phone));
await step("invite caregiver with narrow scopes, accept, caregiver records a reading", async () => {
  await stepUp(patientToken);
  const inv = await api("POST", "/profiles/current/caregivers", { ...P, body: { phone: CAREGIVER.phone, scopes: ["view_tests", "add_measurements"], relationship: "child", label: CAREGIVER.name } });
  await api("POST", "/caregivers/accept", { token: caregiverToken, body: { invitationId: inv.id } });
  await api("POST", "/profiles/current/observations", { token: caregiverToken, profileId, body: { concept: "blood_pressure", valueNumeric: 129, valueNumeric2: 80, measuredAt: daysAgo(0, 7) } });
});

// ---------- clinic ----------
await step("clinic onboards the patient and proposes a reconciliation (left for the patient to decide)", async () => {
  await stepUp(patientToken);
  const tok = await api("POST", "/profiles/current/onboarding-tokens", { ...P, body: { sections: ["medications", "allergies", "glucoseReadings", "bloodPressureReadings"], expiresIn: "1h", accessDays: 7 } });
  await api("POST", "/provider/auth/login", { body: { phone: CLINIC_PHONE } });
  const pv = await api("POST", "/provider/auth/totp", { body: { phone: CLINIC_PHONE, code: CODE } });
  const ptoken = pv.token;
  let orgId;
  try {
    const s = await api("GET", "/provider/auth/session", { token: ptoken });
    orgId = s.organization?.id ?? s.organizations?.[0]?.id ?? s.memberships?.[0]?.organizationId;
  } catch {
    // A single-organisation session resolves its org without the header.
  }
  const link = await api("POST", "/provider/patients/onboard", { token: ptoken, orgId, body: { qrToken: tok.token } });
  const linkId = link.id ?? link.linkId;
  await api("POST", `/provider/patients/${linkId}/reconciliations`, { token: ptoken, orgId, body: {
    notes: "Annual review", practitionerName: "Dr Mehta",
    lines: [
      { decision: "START", proposedName: "Amlodipine 5", proposedInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } },
      { decision: "CONTINUE", patientMedicationId: metforminId },
      { decision: "STOP", patientMedicationId: atorvastatinId, reasonText: "LDL at target" },
    ],
  } });
});

// ---------- ABHA (mock gateway) ----------
await step("ABHA linked against the mock gateway", async () => {
  await stepUp(patientToken);
  const init = await api("POST", "/profiles/current/abha/link/init", { ...P, body: { method: "abha_number", abhaNumber: "91-1234-5678-9012" } });
  await api("POST", "/profiles/current/abha/link/verify", { ...P, body: { transactionId: init.transactionId, otp: CODE } });
});

// ---------- browser: sign in as the patient and screenshot every screen ----------
await step("browser screenshots of every V2 screen", async () => {
  // The session cookie carries the same opaque token the API issued above.
  const state = { cookies: [{ name: "medpass_session", value: patientToken, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax", expires: -1 }], origins: [] };
  const browser = await chromium.launch();
  const bctx = await browser.newContext({ storageState: state, viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  await bctx.addInitScript((id) => window.localStorage.setItem("medpass_profile_id", id), profileId);
  const page = await bctx.newPage();
  const shots = [
    ["01-home", "/"], ["02-health-record", "/health"], ["03-condition-hub", `/conditions/${conditionId}`],
    ["04-medicine-detail", `/medicines/${metforminId}`], ["05-prescription", `/prescriptions/${prescriptionId}`],
    ["06-documents", "/documents"], ["07-document-review", `/documents/${documentId}/review`],
    ["08-reports", "/reports"], ["09-hba1c-trend", `/reports/trends/${analyte?.key ?? "hba1c"}`],
    ["10-measurements", "/measurements"], ["11-bp-trend", "/measurements/blood_pressure/trends"],
    ["12-add", "/add"], ["13-profile", "/profile"], ["14-activity", "/activity"], ["15-notifications", "/profile/notifications"],
    ["16-share", "/share"], ["17-proposals", "/proposals"], ["18-connections", "/connections"], ["19-abha", "/abha"], ["20-family", "/family"],
  ];
  let n = 0;
  for (const [name, path] of shots) {
    await page.goto(`${WEB}${path}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    n++;
  }
  await browser.close();
  return `${n} screenshots in ${OUT}`;
});

console.log("\n==== summary ====");
for (const r of report) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.note ? " — " + r.note : ""}`);
console.log(`\nLog in at ${WEB} with ${PATIENT.phone} (code ${CODE}); caregiver ${CAREGIVER.phone}; clinic at http://localhost:3003 with ${CLINIC_PHONE}.`);
process.exit(report.some((r) => !r.ok) ? 1 : 0);
