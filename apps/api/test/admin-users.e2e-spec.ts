import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";

/**
 * Admin user info + onboarding analysis (users_view duty): identity and
 * engagement only — the response must NEVER carry clinical content, the
 * phone must arrive masked, and every view must land on the audit chain.
 */
describe("Admin users e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000881";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, admin_sessions, admin_users,
        patient_medications, medication_instructions, medication_changes,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAdminWithSession(email: string, duties: string[]): Promise<string[]> {
    const admin = await prisma.adminUser.create({ data: { email, passwordHash: hashPassword("test-password-123"), duties: duties as never } });
    const token = newOpaqueToken();
    await prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashSessionToken(token),
        refreshTokenHash: hashSessionToken(newOpaqueToken()),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return [`medpass_admin_session=${token}`];
  }

  it("sets up a patient with a medicine (fixture for the counts)", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    const token = verify.body.token;
    const profile = await request(app.getHttpServer())
      .post("/v1/profiles")
      .set("authorization", `Bearer ${token}`)
      .set("x-requested-with", "medpass")
      .send({ displayName: "Admin Users Fixture", yearOfBirth: 1968, preferredLocale: "en" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/v1/profiles/current/medications")
      .set("authorization", `Bearer ${token}`)
      .set("x-requested-with", "medpass")
      .set("x-profile-id", profile.body.id)
      .set("idempotency-key", crypto.randomUUID())
      .send({ enteredName: "Fixture Secret Medicine", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(201);
  });

  it("without users_view duty, the overview is forbidden (403); operations_view does not grant it", async () => {
    const none = await createAdminWithSession("users-noduty@test.com", []);
    await request(app.getHttpServer()).get("/v1/admin/users/overview").set("Cookie", none).expect(403);
    const ops = await createAdminWithSession("users-opsonly@test.com", ["operations_view"]);
    await request(app.getHttpServer()).get("/v1/admin/users/overview").set("Cookie", ops).expect(403);
  });

  it("with users_view: identity + engagement rows, masked phone, weekly buckets — and never clinical content", async () => {
    const cookies = await createAdminWithSession("users-viewer@test.com", ["users_view"]);
    const res = await request(app.getHttpServer()).get("/v1/admin/users/overview").set("Cookie", cookies).expect(200);

    expect(res.body.totals.users).toBe(1);
    const row = res.body.items[0];
    expect(row.displayName).toBe("Admin Users Fixture");
    expect(row.yearOfBirth).toBe(1968);
    expect(row.medications).toBe(1);
    expect(row.usageDays).toBeGreaterThanOrEqual(1);
    // Masked: keeps dialing prefix + last four, never the middle digits.
    expect(row.phoneMasked).toBe("+91••••••0881");
    expect(JSON.stringify(res.body)).not.toContain("9000000881".slice(0, 9));

    // The one clinical fact in the DB must not appear anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain("Fixture Secret Medicine");

    // Weekly buckets cover this week and sum to the user count.
    const weeks = res.body.onboardingByWeek;
    expect(weeks.length).toBeGreaterThanOrEqual(1);
    expect(weeks.reduce((acc: number, w: { count: number }) => acc + w.count, 0)).toBe(1);

    // The view itself is on the audit chain.
    const audit = await prisma.auditEvent.findFirst({ where: { action: "admin.users_viewed" } });
    expect(audit).toBeTruthy();
  });
});
