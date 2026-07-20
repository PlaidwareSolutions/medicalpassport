import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 4 follow-up e2e: granting/revoking `sms_reminders` consent cascades
 * to an SMS `NotificationChannel` (docs/18 — "cascade enforcement hooks
 * land with their features"). The actual SMS *send* (via Telnyx, OD-10
 * resolved this pass) was verified live against the real Telnyx API rather
 * than exercised here — a real per-message cost and an external network
 * dependency don't belong in the automated suite; this covers the API
 * surface and DB-side effects the cron's dispatch pass depends on.
 */
describe("SMS reminder consent cascade e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000901";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, notification_attempts, notifications,
        notification_channels, notification_preferences, consent_events,
        consents, dose_events, scheduled_doses, medication_schedules,
        medication_changes, medication_instructions, patient_medications,
        practitioners, patient_allergies, patient_conditions,
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

  let token: string;
  let profileId: string;
  let userId: string;

  it("signs in and creates a profile", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "SMS Reminder Test", yearOfBirth: 1988, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;

    const session = await prisma.session.findFirstOrThrow({ orderBy: { createdAt: "desc" }, select: { userId: true } });
    userId = session.userId;
  });

  let consentId: string;

  it("granting sms_reminders consent activates an SMS notification channel", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/consents"))
      .send({ type: "sms_reminders", purpose: "Send a text when a dose reminder or refill/completion reminder fires." })
      .expect(201);
    expect(res.body.type).toBe("sms_reminders");
    expect(res.body.status).toBe("active");
    consentId = res.body.id;

    const channel = await prisma.notificationChannel.findFirstOrThrow({ where: { userId, channel: "sms" } });
    expect(channel.status).toBe("active");
    expect(channel.addressCiphertext).not.toContain(PHONE); // encrypted, not the raw phone number
    expect(channel.addressCiphertext.length).toBeGreaterThan(20);

    const audit = await prisma.auditEvent.findFirst({
      where: { patientProfileId: profileId, action: "consent.granted", context: { path: ["type"], equals: "sms_reminders" } },
    });
    expect(audit).toBeTruthy();
  });

  it("re-granting the same consent type reuses the same channel row rather than duplicating it", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/consents"))
      .send({ type: "sms_reminders", purpose: "Renewed consent for SMS reminders." })
      .expect(201);
    const channels = await prisma.notificationChannel.findMany({ where: { userId, channel: "sms" } });
    expect(channels).toHaveLength(1);
    expect(channels[0]!.status).toBe("active");
  });

  it("revoking the consent revokes the SMS channel", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/consents/${consentId}/revoke`)).expect(201);

    const channel = await prisma.notificationChannel.findFirstOrThrow({ where: { userId, channel: "sms" } });
    expect(channel.status).toBe("revoked");

    const audit = await prisma.auditEvent.findFirst({
      where: { patientProfileId: profileId, action: "consent.revoked" },
    });
    expect(audit).toBeTruthy();
  });

  it("granting sms_reminders again reactivates the same channel", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/consents"))
      .send({ type: "sms_reminders", purpose: "Opting back in to SMS reminders." })
      .expect(201);
    const channel = await prisma.notificationChannel.findFirstOrThrow({ where: { userId, channel: "sms" } });
    expect(channel.status).toBe("active");
  });

  it("granting an unrelated consent type never touches notification channels", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/consents"))
      .send({ type: "email", purpose: "Send email updates." })
      .expect(201);
    const channels = await prisma.notificationChannel.findMany({ where: { userId } });
    expect(channels).toHaveLength(1); // still just the sms channel from before
  });
});
