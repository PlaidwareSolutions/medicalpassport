import request from "supertest";
import { getPrisma } from "@medpass/database";
import { encryptField, phoneDigest } from "../../src/common/crypto";

/**
 * Provider-portal spec helpers (V2 Phases 11–14). There is no self-serve
 * organization creation on the API — the first owner is seeded by the
 * admin portal / pilot onboarding — so specs seed the organization and its
 * owner straight into the database, then sign in through the real routes.
 */
const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

export const authHeaders = (token: string, profileId?: string) => (req: request.Test) => {
  req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
  if (profileId) req.set("x-profile-id", profileId);
  return req;
};

export async function seedOrganization(opts: {
  kind: "clinic" | "hospital" | "pharmacy" | "laboratory" | "diagnostic_centre" | "other";
  displayName: string;
  ownerPhone: string;
}): Promise<{ organizationId: string; ownerUserId: string }> {
  const prisma = getPrisma();
  const digest = phoneDigest(opts.ownerPhone);
  const user =
    (await prisma.user.findUnique({ where: { phoneDigest: digest } })) ??
    (await prisma.user.create({
      data: { phoneDigest: digest, phoneCiphertext: encryptField(opts.ownerPhone), userKind: "provider", phoneVerifiedAt: new Date() },
    }));
  if (user.userKind === "patient") await prisma.user.update({ where: { id: user.id }, data: { userKind: "both" } });
  const organization = await prisma.organization.create({ data: { kind: opts.kind, displayName: opts.displayName } });
  await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: "owner" } });
  return { organizationId: organization.id, ownerUserId: user.id };
}

/** Phone OTP → provider session token (`mpp_…`). Clears this number's spent OTP rows first (5/hour send cap). */
export async function providerSignIn(server: Parameters<typeof request>[0], phone: string, organizationId?: string): Promise<string> {
  const prisma = getPrisma();
  await prisma.otpAttempt.deleteMany({ where: { phoneDigest: phoneDigest(phone) } });
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: "provider_" } } });
  await request(server).post("/v1/provider/auth/login").send({ phone }).expect(202);
  const res = await request(server).post("/v1/provider/auth/totp").send({ phone, code: CODE }).expect(201);
  void organizationId;
  return res.body.token as string;
}

/** Phone OTP → patient session token, same as the other specs do inline. */
export async function patientSignIn(server: Parameters<typeof request>[0], phone: string): Promise<string> {
  const prisma = getPrisma();
  await prisma.otpAttempt.deleteMany({ where: { phoneDigest: phoneDigest(phone) } });
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: "otp_" } } });
  await request(server).post("/v1/auth/otp/request").send({ phone }).expect(202);
  const verify = await request(server)
    .post("/v1/auth/otp/verify")
    .send({ phone, code: CODE, device: { kind: "browser" } })
    .expect(201);
  return verify.body.token as string;
}
