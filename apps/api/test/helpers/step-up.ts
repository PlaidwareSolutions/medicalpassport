import request from "supertest";
import { getPrisma } from "@medpass/database";
import { hashSessionToken } from "../../src/common/crypto";

/**
 * ADR-V2-012: guarded endpoints (share creation, caregiver management, …)
 * need the session to have re-verified within the last 10 minutes. With the
 * log OTP transport the code is the fixed dev code, so a spec can elevate a
 * bearer session in two calls. Returns the verification timestamp.
 *
 * Test-only conveniences, each guarding a real production limit that a test
 * run would otherwise trip:
 *  - memoised per token for the freshness window (a spec creating six shares
 *    elevates once);
 *  - the per-IP `step_up_*` rate-limit buckets are cleared (every spec shares
 *    one loopback IP);
 *  - this user's already-consumed OTP attempts are deleted (the per-number
 *    send cap of 5/hour counts login + step-up together, and specs reuse
 *    fixed phone numbers across runs). Unconsumed attempts are left alone.
 */
const fresh = new Map<string, { at: string; expiresAtMs: number }>();
const FRESH_FOR_MS = 9 * 60 * 1000;

export async function stepUp(
  server: Parameters<typeof request>[0],
  token: string,
  code = process.env.OTP_DEV_FIXED_CODE ?? "000000",
): Promise<string> {
  const cached = fresh.get(token);
  if (cached && cached.expiresAtMs > Date.now()) return cached.at;

  const prisma = getPrisma();
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: "step_up_" } } });
  const session = await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(token) }, include: { user: true } });
  if (session) {
    await prisma.otpAttempt.deleteMany({ where: { phoneDigest: session.user.phoneDigest, consumedAt: { not: null } } });
  }

  await request(server).post("/v1/auth/step-up").set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass").expect(202);
  const res = await request(server)
    .post("/v1/auth/step-up/verify")
    .set("authorization", `Bearer ${token}`)
    .set("x-requested-with", "medpass")
    .send({ code })
    .expect(201);
  const at = res.body.stepUpVerifiedAt as string;
  fresh.set(token, { at, expiresAtMs: Date.now() + FRESH_FOR_MS });
  return at;
}
