import { mkdirSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { request, type APIRequestContext } from "@playwright/test";

/**
 * A signed-in patient of its own, for specs that must not share the global
 * setup's account. Two reasons this exists rather than reusing
 * `STORAGE_STATE`: an OTP send is rate-limited per phone number (30 s
 * between sends), so a spec that needs a step-up would race every other
 * spec for the same number; and these specs mutate the medicine list, which
 * the reflow/axe sweeps read.
 *
 * The storage state holds only the API's session cookie — host-scoped, so
 * the browser on :3101 sends it to the API on :4101 the same way the real
 * app does. No profile id is written: `SessionProvider` picks the single
 * profile itself, which is exactly what a real first sign-in does.
 */

export const API = process.env.E2E_API_URL ?? "http://localhost:4000";
export const OTP_CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

/** The API's per-number OTP send cooldown, plus a second of slack. */
const SEND_COOLDOWN_MS = 31_000;

const apiRequire = createRequire(join(__dirname, "..", "..", "api", "package.json"));

export interface ApiPrisma {
  user: { findUnique(args: unknown): Promise<{ id: string } | null>; update(args: unknown): Promise<unknown> };
  organization: { create(args: unknown): Promise<{ id: string }> };
  organizationMember: { create(args: unknown): Promise<unknown> };
  otpAttempt: { deleteMany(args: unknown): Promise<unknown> };
  rateLimitBucket: { deleteMany(args: unknown): Promise<unknown> };
  $disconnect(): Promise<void>;
}

/**
 * The API's own Prisma client, reached through `apps/api` so the workspace
 * link resolves. Specs here use it for the two things the HTTP surface
 * deliberately does not expose: seeding a provider organization (there is
 * no self-serve organization API) and clearing this run's own OTP state.
 */
export function apiPrisma(): ApiPrisma {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set for specs that seed through the database");
  return (apiRequire("@medpass/database") as { getPrisma(): ApiPrisma }).getPrisma();
}

/** The API's phone digest (apps/api/src/common/crypto.ts), so cleanups can be scoped to one number. */
export function phoneDigest(phone: string): string {
  const pepper = process.env.OTP_HASH_PEPPER;
  if (!pepper) throw new Error("OTP_HASH_PEPPER must be set for specs that seed through the database");
  return createHmac("sha256", pepper + ":phone").update(phone).digest("hex");
}

/**
 * `otp_request` allows 10 per hour *per IP*, and every spec in this suite
 * signs in from 127.0.0.1 — a few repeated local runs inside one hour
 * exhaust it and every later sign-in answers 429. Clearing the buckets is
 * the same move `apps/api/test/helpers/provider.ts` makes for the same
 * reason; no patient-web spec asserts on rate limiting.
 */
export async function resetOtpRateLimits(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await apiPrisma().rateLimitBucket.deleteMany({ where: { OR: [{ key: { contains: "otp_" } }, { key: { contains: "step_up_" } }] } });
}

export interface FreshPatient {
  phone: string;
  profileId: string;
  storageState: string;
  /** API context carrying the same session the browser will use. */
  ctx: APIRequestContext;
  /** Waits out the OTP cooldown, then re-verifies the session (10-minute step-up window). */
  stepUp: () => Promise<void>;
  dispose: () => Promise<void>;
}

function randomPhone(): string {
  return "+9198" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}

export async function createFreshPatient(label: string, displayName: string): Promise<FreshPatient> {
  const phone = randomPhone();
  await resetOtpRateLimits();
  const ctx = await request.newContext({ baseURL: API, extraHTTPHeaders: { "x-requested-with": "medpass" } });

  const requested = await ctx.post("/v1/auth/otp/request", { data: { phone } });
  if (!requested.ok()) throw new Error(`otp/request failed: ${requested.status()} ${await requested.text()}`);
  let lastSendAt = Date.now();

  const verified = await ctx.post("/v1/auth/otp/verify", {
    data: { phone, code: OTP_CODE, device: { kind: "browser" }, locale: "en", rememberDevice: true },
  });
  if (!verified.ok()) throw new Error(`otp/verify failed: ${verified.status()} ${await verified.text()}`);

  const profileRes = await ctx.post("/v1/profiles", { data: { displayName, yearOfBirth: 1958, preferredLocale: "en" } });
  if (!profileRes.ok()) throw new Error(`profile create failed: ${profileRes.status()} ${await profileRes.text()}`);
  const profileId = ((await profileRes.json()) as { id: string }).id;

  const storageState = join(__dirname, ".auth", `${label}-${randomUUID().slice(0, 8)}.json`);
  mkdirSync(dirname(storageState), { recursive: true });
  await ctx.storageState({ path: storageState });

  return {
    phone,
    profileId,
    storageState,
    ctx,
    async stepUp() {
      const wait = SEND_COOLDOWN_MS - (Date.now() - lastSendAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      await resetOtpRateLimits();
      const sent = await ctx.post("/v1/auth/step-up");
      lastSendAt = Date.now();
      if (!sent.ok()) throw new Error(`step-up request failed: ${sent.status()} ${await sent.text()}`);
      const ok = await ctx.post("/v1/auth/step-up/verify", { data: { code: OTP_CODE } });
      if (!ok.ok()) throw new Error(`step-up verify failed: ${ok.status()} ${await ok.text()}`);
    },
    async dispose() {
      await ctx.dispose();
    },
  };
}

/** Headers a patient API call needs, matching what the real client sends. */
export function patientHeaders(profileId: string): Record<string, string> {
  return { "x-profile-id": profileId, "x-requested-with": "medpass" };
}
