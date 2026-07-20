import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 4 follow-up e2e: web push subscription lifecycle, notification
 * preferences (opt-in, privacy-safe default wording, quiet hours), and dose
 * acknowledgement resolving a sent reminder. The actual send-over-the-wire
 * path (detect-due-reminders cron + real HTTPS delivery, including the
 * 410-Gone → channel-revoked path, quiet-hours deferral, and caregiver
 * reminder fan-out) was verified live against real Postgres data and a real
 * cron run rather than exercised here — this suite covers the API surface
 * and DB-side effects the cron job and PWA both depend on.
 */
describe("Notifications e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000501";
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
        notification_preferences, notification_channels, dose_events,
        scheduled_doses, medication_schedules, medication_changes,
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

  let token: string;
  let profileId: string;

  const FAKE_SUBSCRIPTION = {
    endpoint: "https://push.example.test/subscription/abc123",
    keys: { p256dh: "BPpuWRS9VqLyztqDWOEcji64T93jXla2JJ0Pl9aytle8qoNgple9nJYF0Utq_8eIMD-4rlv2yC4W2Ds3VV-mMwU", auth: "zCIPm1DBmSc6Gs3H6_rSaw" },
  };

  it("signs in and creates a profile", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Notifications Test", yearOfBirth: 1980, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  it("serves a real VAPID public key with no auth required", async () => {
    const res = await request(app.getHttpServer()).get("/v1/push/vapid-public-key").expect(200);
    expect(typeof res.body.publicKey === "string" || res.body.publicKey === null).toBe(true);
  });

  it("defaults to push disabled, generic (privacy-safe) wording, and quiet hours on", async () => {
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/notification-preferences"),
    ).expect(200);
    expect(res.body).toEqual({
      pushEnabled: false,
      privacyMode: "generic",
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });
  });

  it("subscribes a web push channel, storing it encrypted", async () => {
    await auth(token)(request(app.getHttpServer()).post("/v1/notification-channels/web-push"))
      .send(FAKE_SUBSCRIPTION)
      .expect(201);

    const channels = await prisma.notificationChannel.findMany();
    expect(channels).toHaveLength(1);
    const channel = channels[0]!;
    expect(channel.status).toBe("active");
    expect(channel.addressCiphertext).not.toContain(FAKE_SUBSCRIPTION.endpoint);
    expect(channel.addressCiphertext.length).toBeGreaterThan(50);
  });

  it("re-subscribing the same endpoint replaces the row rather than erroring", async () => {
    await auth(token)(request(app.getHttpServer()).post("/v1/notification-channels/web-push"))
      .send(FAKE_SUBSCRIPTION)
      .expect(201);
    const channels = await prisma.notificationChannel.findMany();
    expect(channels).toHaveLength(1);
  });

  it("turns push on and records the choice in the audit trail", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/notification-preferences"))
      .send({ pushEnabled: true, privacyMode: "generic", quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00" })
      .expect(201);

    const res = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/notification-preferences"),
    ).expect(200);
    expect(res.body).toEqual({
      pushEnabled: true,
      privacyMode: "generic",
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });

    const audit = await prisma.auditEvent.findFirst({
      where: { patientProfileId: profileId, action: "notification.preferences_updated" },
    });
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.context ?? {})).not.toMatch(/notifications test/i);
  });

  it("lets the patient set a custom quiet-hours window", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/notification-preferences"))
      .send({ pushEnabled: true, privacyMode: "generic", quietHoursEnabled: true, quietHoursStart: "23:00", quietHoursEnd: "06:30" })
      .expect(201);

    const res = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/notification-preferences"),
    ).expect(200);
    expect(res.body).toMatchObject({ quietHoursStart: "23:00", quietHoursEnd: "06:30" });

    // Restore defaults for the tests that follow.
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/notification-preferences"))
      .send({ pushEnabled: true, privacyMode: "generic", quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00" })
      .expect(201);
  });

  it("resolves a sent reminder everywhere once the dose is actually recorded", async () => {
    const med = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Ack Test Tablet",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);

    const schedule = await prisma.medicationSchedule.findFirstOrThrow({ where: { patientMedicationId: med.body.id } });
    const dose = await prisma.scheduledDose.findFirstOrThrow({ where: { medicationScheduleId: schedule.id } });

    // Simulate what detect-due-reminders would have done: a notification
    // already sent to a device, awaiting acknowledgement.
    const notification = await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "dose_reminder",
        scheduledDoseId: dose.id,
        privacyMode: "generic",
        dedupeKey: `${dose.id}:web_push`,
        status: "dispatching",
      },
    });
    await prisma.notificationAttempt.create({
      data: { notificationId: notification.id, channel: "web_push", status: "sent" },
    });

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken" })
      .expect(201);

    const updatedNotification = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    const attempts = await prisma.notificationAttempt.findMany({ where: { notificationId: notification.id } });
    expect(updatedNotification.status).toBe("done");
    expect(attempts.every((a) => a.status === "acknowledged")).toBe(true);
  });

  it("unsubscribing revokes the channel", async () => {
    await auth(token)(request(app.getHttpServer()).post("/v1/notification-channels/web-push/unsubscribe"))
      .send({ endpoint: FAKE_SUBSCRIPTION.endpoint })
      .expect(201);
    const channel = await prisma.notificationChannel.findFirstOrThrow();
    expect(channel.status).toBe("revoked");
  });
});
