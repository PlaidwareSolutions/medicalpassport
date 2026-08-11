import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { request, type FullConfig } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
export const STORAGE_STATE = join(__dirname, ".auth/storage-state.json");
export const FIXTURE_PATH = join(__dirname, ".auth/fixture.json");

/**
 * Canonical synthetic marketing-demo identity (Session 8 §5 — documented in
 * docs/landing-page/media-recording-framework.md):
 *
 *   Patient profile : "Asha Demo"  (unmistakably synthetic; born 1962)
 *   Phone           : fresh random +9198XXXXXXXX per run — the same fake
 *                     range the e2e suite uses; a new account per run makes
 *                     reset trivially idempotent (nothing accumulates), and
 *                     the phone number is never shown in any recorded flow.
 *   Prescriber      : "Dr. Demo Mehta" (fictional, self-labelling)
 *   Medicines       : seeded from the verified dev catalog only —
 *                     Amlong 5 (1-0-0, any) and Glyciphage 500 (1-0-1,
 *                     after food) so the timeline has morning + night slots;
 *                     the R2 recording itself adds Dolo 650 (SOS) live so
 *                     scheduled slots stay deterministic for R1/R3.
 *
 * No real patient, no real prescriptions, no real phone numbers, no
 * clinically gated features. Login uses the same real OTP flow as the e2e
 * suite (fixed dev code, local stack only).
 */
export default async function globalSetup(_config: FullConfig) {
  const phone = "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const ctx = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { "x-requested-with": "medpass" },
  });

  const requested = await ctx.post("/v1/auth/otp/request", { data: { phone } });
  if (!requested.ok()) throw new Error(`otp/request failed: ${requested.status()} ${await requested.text()}`);

  const verified = await ctx.post("/v1/auth/otp/verify", {
    data: {
      phone,
      code: process.env.OTP_DEV_FIXED_CODE ?? "000000",
      device: { kind: "browser" },
      locale: "en",
      rememberDevice: true,
    },
  });
  if (!verified.ok()) throw new Error(`otp/verify failed: ${verified.status()} ${await verified.text()}`);

  const profileRes = await ctx.post("/v1/profiles", {
    data: { displayName: "Asha Demo", yearOfBirth: 1962, preferredLocale: "en" },
  });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  const profile = (await profileRes.json()) as { id: string };

  const seedMedication = async (data: object) => {
    const res = await ctx.post("/v1/profiles/current/medications", {
      headers: { "x-profile-id": profile.id, "idempotency-key": randomUUID() },
      data,
    });
    if (!res.ok()) throw new Error(`medication create failed: ${res.status()} ${await res.text()}`);
    return (await res.json()) as { id: string };
  };

  // Catalog-linked seeding (Session 9A §5 fix): manual enteredName-only
  // entries trigger real uncertain_normalization safety findings, which put
  // the clinically gated "Needs review" section into marketing frames —
  // claim drift (§25). Linking productId keeps every recording surface
  // inside ungated claims. The recording specs assert "Needs review" is
  // absent as a standing guard.
  const findProduct = async (q: string): Promise<string> => {
    const res = await ctx.get(`/v1/catalog/products?q=${encodeURIComponent(q)}`, {
      headers: { "x-profile-id": profile.id },
    });
    if (!res.ok()) throw new Error(`catalog search failed for ${q}: ${res.status()}`);
    const items = ((await res.json()) as { items: { id: string; brandName: string }[] }).items;
    const hit = items.find((i) => i.brandName.toLowerCase().includes(q.toLowerCase())) ?? items[0];
    if (!hit) throw new Error(`no catalog product found for ${q}`);
    return hit.id;
  };

  const amlong = await seedMedication({
    productId: await findProduct("Amlong"),
    prescriberName: "Dr. Demo Mehta",
    patientReason: "Blood pressure",
    source: "search",
    quantityOnHand: 28,
    instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-0-0", foodInstruction: "any" },
  });
  const glyciphage = await seedMedication({
    productId: await findProduct("Glyciphage"),
    prescriberName: "Dr. Demo Mehta",
    patientReason: "Blood sugar",
    source: "search",
    quantityOnHand: 30,
    instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "PATTERN", pattern: "1-0-1", foodInstruction: "after" },
  });

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  await ctx.storageState({ path: STORAGE_STATE });
  writeFileSync(
    FIXTURE_PATH,
    JSON.stringify(
      { phone, profileId: profile.id, medications: { amlong: amlong.id, glyciphage: glyciphage.id }, seededAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  await ctx.dispose();
}
