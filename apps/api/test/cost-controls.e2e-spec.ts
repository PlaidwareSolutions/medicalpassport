import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { ERROR_CODES } from "@medpass/domain";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 11 follow-up e2e: cost controls (docs/31 "Enforced limits" — never
 * weaken clinical safety to reduce cost; these throttle abuse/waste only).
 * Covers the two API-level mechanisms added this pass: a per-profile document
 * storage quota (soft warn at 80%, hard cap at 200MB) and a per-user daily
 * upload count quota (reusing RateLimitService). The reminder-channel SMS cap
 * (in apps/cron, no NestJS DI) was verified live against a real compiled
 * detect-due-reminders run instead, matching the missed-dose-escalation and
 * sms-reminders suites' existing testing boundary between API and cron.
 */
describe("Cost controls e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, object_access_events,
        prescription_documents, stored_objects, medication_changes,
        medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  async function signInAndCreateProfile(phone: string, displayName: string) {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    const token = verify.body.token;
    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName, yearOfBirth: 1970, preferredLocale: "en" })
      .expect(201);
    return { token, profileId: profile.body.id as string };
  }

  /** Seeds already-"verified" (i.e. actually counted) storage usage for a profile without going through a real upload. */
  async function seedVerifiedUsage(profileId: string, sizeBytes: number) {
    const storedObject = await prisma.storedObject.create({
      data: {
        bucket: "patient_docs",
        objectKey: `test-seed/${randomUUID()}`,
        contentType: "image/png",
        status: "verified",
        sizeBytes,
        sha256: randomUUID().replace(/-/g, ""),
      },
    });
    await prisma.prescriptionDocument.create({
      data: { patientProfileId: profileId, storedObjectId: storedObject.id, kind: "prescription", status: "uploaded" },
    });
  }

  describe("Per-profile document storage quota (soft warn + hard cap)", () => {
    let token: string;
    let profileId: string;

    it("signs in and creates a profile", async () => {
      ({ token, profileId } = await signInAndCreateProfile("+919000009101", "Storage Quota Test"));
    });

    it("authorizes a small upload with no warning when usage is low", async () => {
      const res = await auth(token, profileId)(
        request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"),
      )
        .send({ kind: "prescription", contentType: "image/png", sizeBytes: 1024 })
        .expect(201);
      expect(res.body.approachingStorageQuota).toBe(false);
    });

    it("warns when a new upload would cross 80% of the 200MB quota, but still allows it", async () => {
      await seedVerifiedUsage(profileId, 150 * 1024 * 1024);

      const res = await auth(token, profileId)(
        request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"),
      )
        .send({ kind: "prescription", contentType: "application/pdf", sizeBytes: 20 * 1024 * 1024 })
        .expect(201);
      expect(res.body.approachingStorageQuota).toBe(true);
    });

    it("rejects an upload that would exceed the hard cap", async () => {
      // Total verified usage is now 150MB; push it to 195MB so the next 10MB request would cross 200MB.
      await seedVerifiedUsage(profileId, 45 * 1024 * 1024);

      const res = await auth(token, profileId)(
        request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"),
      )
        .send({ kind: "prescription", contentType: "image/png", sizeBytes: 10 * 1024 * 1024 })
        .expect(400);
      expect(res.body.code).toBe(ERROR_CODES.STORAGE_QUOTA_EXCEEDED);
      expect(res.body.title).toMatch(/storage limit/i);
    });
  });

  describe("Per-user daily upload count quota", () => {
    let token: string;
    let profileId: string;

    it("signs in and creates a profile", async () => {
      ({ token, profileId } = await signInAndCreateProfile("+919000009102", "Daily Quota Test"));
    });

    it("allows up to 20 authorize-upload calls in a day, then rejects the 21st", async () => {
      // This route also carries a separate per-IP anti-abuse budget
      // (RateLimitGuard's "document_upload", also 20/hour — built in the
      // earlier rate-limiting pass). Every request in this suite shares one
      // loopback IP, so reset that unrelated bucket here and just before the
      // boundary call, to isolate the per-*user* daily quota under test.
      const resetIpGuardBudget = () =>
        prisma.rateLimitBucket.deleteMany({ where: { key: { startsWith: "document_upload:" } } });

      await resetIpGuardBudget();
      for (let i = 0; i < 20; i++) {
        await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"))
          .send({ kind: "prescription", contentType: "image/png", sizeBytes: 1024 })
          .expect(201);
      }

      await resetIpGuardBudget();
      const res = await auth(token, profileId)(
        request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"),
      )
        .send({ kind: "prescription", contentType: "image/png", sizeBytes: 1024 })
        .expect(429);
      expect(res.body.code).toBe(ERROR_CODES.RATE_LIMITED);
      expect(res.body.title).toMatch(/upload limit/i);
    }, 30000);

    it("a different user's daily upload budget is unaffected", async () => {
      const other = await signInAndCreateProfile("+919000009103", "Independent Budget Test");
      await auth(other.token, other.profileId)(
        request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"),
      )
        .send({ kind: "prescription", contentType: "image/png", sizeBytes: 1024 })
        .expect(201);
    });
  });
});
