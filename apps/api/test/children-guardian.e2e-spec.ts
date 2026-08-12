import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { phoneDigest } from "../src/common/crypto";

/**
 * Children V1 (docs/landing-page/children-guardian-remediation-design.md):
 * - a person under 18 may not run their own adult (self) account;
 * - a child dependent requires an explicit parent/lawful-guardian attestation;
 * - adult dependents are unaffected.
 */
describe("Children/guardian V1 e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
  const CURRENT_YEAR = new Date().getFullYear();
  const MINOR_YEAR = CURRENT_YEAR - 10; // clearly under 18
  const ADULT_YEAR = 1985;
  const phones: string[] = [];

  const freshPhone = () => {
    const p = "+9196" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    phones.push(p);
    return p;
  };

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  async function signIn(phone: string): Promise<string> {
    await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: "otp_" } } });
    await prisma.otpAttempt.deleteMany({ where: { phoneDigest: phoneDigest(phone) } });
    await request(app.getHttpServer()).post("/v1/auth/otp/request").set("x-requested-with", "medpass").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .set("x-requested-with", "medpass")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    return verify.body.token as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    try {
      const digests = phones.map((p) => phoneDigest(p));
      const users = await prisma.user.findMany({ where: { phoneDigest: { in: digests } }, select: { id: true } });
      const userIds = users.map((u) => u.id);
      const profiles = await prisma.patientProfile.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } });
      const profileIds = profiles.map((p) => p.id);
      await prisma.consentEvent.deleteMany({ where: { consent: { patientProfileId: { in: profileIds } } } });
      await prisma.consent.deleteMany({ where: { patientProfileId: { in: profileIds } } });
      await prisma.auditEvent.deleteMany({ where: { patientProfileId: { in: profileIds } } });
      await prisma.patientProfile.deleteMany({ where: { id: { in: profileIds } } });
      await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.userDevice.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } catch {
      /* best-effort cleanup */
    }
    await app.close();
  });

  it("allows an adult to create their own (self) profile", async () => {
    const token = await signIn(freshPhone());
    await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Adult Self", yearOfBirth: ADULT_YEAR, preferredLocale: "en" })
      .expect(201);
  });

  it("blocks a person under 18 from creating their own (self) account", async () => {
    const token = await signIn(freshPhone());
    const res = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Minor Self", yearOfBirth: MINOR_YEAR, preferredLocale: "en" })
      .expect(403);
    expect(res.body.code).toBe("self_account_minor");
  });

  it("requires year of birth for a self profile", async () => {
    const token = await signIn(freshPhone());
    const res = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "No Year", preferredLocale: "en" })
      .expect(400);
    expect(res.body.code).toBe("validation_failed");
  });

  it("requires guardian attestation for a child dependent (by relationship)", async () => {
    const token = await signIn(freshPhone());
    const res = await auth(token)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Child NoAttest", relationship: "child", preferredLocale: "en" })
      .expect(400);
    expect(res.body.code).toBe("guardian_attestation_required");
  });

  it("creates a child dependent with attestation and stores the attestation", async () => {
    const token = await signIn(freshPhone());
    const res = await auth(token)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Child OK", relationship: "child", yearOfBirth: MINOR_YEAR, guardianAttestation: true, preferredLocale: "en" })
      .expect(201);
    const profile = await prisma.patientProfile.findUnique({ where: { id: res.body.id } });
    expect(profile?.guardianAttestedByUserId).toBeTruthy();
    expect(profile?.guardianAttestedAt).toBeTruthy();
    expect(profile?.guardianAttestationVersion).toBeTruthy();
  });

  it("requires attestation for a minor dependent even when relationship is not 'child'", async () => {
    const token = await signIn(freshPhone());
    const res = await auth(token)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Minor Sibling", relationship: "sibling", yearOfBirth: MINOR_YEAR, preferredLocale: "en" })
      .expect(400);
    expect(res.body.code).toBe("guardian_attestation_required");
  });

  it("does not require attestation for an adult dependent", async () => {
    const token = await signIn(freshPhone());
    const res = await auth(token)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Elderly Parent", relationship: "parent", yearOfBirth: ADULT_YEAR, preferredLocale: "en" })
      .expect(201);
    const profile = await prisma.patientProfile.findUnique({ where: { id: res.body.id } });
    expect(profile?.guardianAttestedByUserId).toBeNull();
  });
});
