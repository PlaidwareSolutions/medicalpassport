import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { request, type FullConfig } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:4000";
export const STORAGE_STATE = join(__dirname, ".auth/storage-state.json");
export const FIXTURE_PATH = join(__dirname, ".auth/fixture.json");

/**
 * Logs in through the real auth flow (fixed dev OTP, docs/28) and seeds one
 * profile with a deliberately long-named medicine so list/detail screens
 * exercise the text shapes that actually overflow at 200% zoom. A fresh
 * random phone per run keeps re-runs clear of the per-phone OTP resend
 * limits and idempotent test data out of each other's way.
 */
export default async function globalSetup(_config: FullConfig) {
  const phone = "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const ctx = await request.newContext({
    baseURL: API,
    // Same CSRF-defence header the real api-client attaches to every call.
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
    data: { displayName: "Reflow Sweep Test Patient", yearOfBirth: 1954, preferredLocale: "en" },
  });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  const profile = (await profileRes.json()) as { id: string };

  // Long brand + prescriber names on purpose: min-content width is the
  // failure mode under test, so seed the worst realistic strings.
  const medRes = await ctx.post("/v1/profiles/current/medications", {
    headers: { "x-profile-id": profile.id, "idempotency-key": randomUUID() },
    data: {
      enteredName: "Metformin Hydrochloride Extended Release 500mg",
      prescriberName: "Dr. Ramachandran Venkatasubramanian",
      patientReason: "Type 2 diabetes long-term management",
      source: "manual",
      quantityOnHand: 30,
      instruction: {
        doseQuantity: 1,
        doseUnit: "tablet",
        frequencyCode: "PATTERN",
        pattern: "1-0-1",
        foodInstruction: "after",
      },
    },
  });
  if (!medRes.ok()) throw new Error(`medication create failed: ${medRes.status()} ${await medRes.text()}`);
  const medication = (await medRes.json()) as { id: string };

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  await ctx.storageState({ path: STORAGE_STATE });
  writeFileSync(FIXTURE_PATH, JSON.stringify({ phone, profileId: profile.id, medicationId: medication.id }, null, 2));
  await ctx.dispose();
}
