import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { MEASUREMENT_REMINDERS_JSON_KEY } from "@medpass/domain";
import { Prisma } from "@medpass/database";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { authHeaders, patientSignIn } from "./helpers/provider";

/**
 * P17 measurement reminders (`GET/PUT profiles/current/measurement-reminders`)
 * and the WhatsApp placeholder. The plan shares `channelFrequencyJson`
 * with the per-kind controls under a reserved key: each side must survive
 * the other being replaced, and the reserved key must never surface on the
 * preferences endpoint nor be settable through it.
 */
describe("Measurement reminders e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();
  const PHONE = "+919000000875";
  let token: string;
  let profileId: string;

  const prefs = { pushEnabled: true, privacyMode: "generic", quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00" };
  const plan = { concepts: { blood_pressure: { times: ["08:00", "20:00"], days: [1, 2, 3, 4, 5] }, body_weight: { times: ["07:30"], days: [7] } } };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, notification_preferences, notification_channels,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
    token = await patientSignIn(server(), PHONE);
    const profile = await authHeaders(token)(request(server()).post("/v1/profiles"))
      .send({ displayName: "Measurement Reminder Owner", yearOfBirth: 1980, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it("starts with no reminders", async () => {
    const res = await authHeaders(token, profileId)(request(server()).get("/v1/profiles/current/measurement-reminders")).expect(200);
    expect(res.body).toEqual({ concepts: {} });
  });

  it("validates times, days and concepts", async () => {
    for (const bad of [
      { concepts: { blood_pressure: { times: ["25:00"], days: [1] } } },
      { concepts: { blood_pressure: { times: ["08:00"], days: [8] } } },
      { concepts: { blood_pressure: { times: ["08:00", "08:00"], days: [1] } } },
      { concepts: { blood_pressure: { times: ["01:00", "02:00", "03:00", "04:00", "05:00", "06:00", "07:00"], days: [1] } } },
      { concepts: { made_up: { times: ["08:00"], days: [1] } } },
      { concepts: { blood_pressure: { times: [], days: [1] } } },
    ]) {
      const res = await authHeaders(token, profileId)(request(server()).put("/v1/profiles/current/measurement-reminders")).send(bad).expect(400);
      expect(res.body.code).toBe("validation_failed");
    }
  });

  it("stores the plan and reads it back; the write is audited without slot times", async () => {
    const put = await authHeaders(token, profileId)(request(server()).put("/v1/profiles/current/measurement-reminders")).send(plan).expect(200);
    expect(put.body).toEqual(plan);
    const get = await authHeaders(token, profileId)(request(server()).get("/v1/profiles/current/measurement-reminders")).expect(200);
    expect(get.body).toEqual(plan);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "notification.measurement_reminders_updated", patientProfileId: profileId } });
    expect(audit?.context).toEqual({ concepts: { blood_pressure: 10, body_weight: 1 } });
  });

  it("the reserved key never surfaces on the preferences endpoint and cannot be set through it", async () => {
    const get = await authHeaders(token, profileId)(request(server()).get("/v1/profiles/current/notification-preferences")).expect(200);
    expect(get.body.channelFrequency).toEqual({});
    expect(JSON.stringify(get.body)).not.toContain(MEASUREMENT_REMINDERS_JSON_KEY);

    const res = await authHeaders(token, profileId)(request(server()).put("/v1/profiles/current/notification-preferences"))
      .send({ ...prefs, channelFrequency: { [MEASUREMENT_REMINDERS_JSON_KEY]: { channels: [], frequency: "off" } } })
      .expect(400);
    expect(res.body.code).toBe("validation_failed");
  });

  it("replacing the per-kind controls keeps the plan, and replacing the plan keeps the controls", async () => {
    await authHeaders(token, profileId)(request(server()).put("/v1/profiles/current/notification-preferences"))
      .send({ ...prefs, channelFrequency: { refill: { channels: ["sms"], frequency: "off" }, test_due: { channels: ["web_push", "email"], frequency: "daily_digest" } } })
      .expect(200);
    const afterPrefs = await authHeaders(token, profileId)(request(server()).get("/v1/profiles/current/measurement-reminders")).expect(200);
    expect(afterPrefs.body).toEqual(plan);

    const smaller = { concepts: { blood_glucose: { times: ["06:45"], days: [1, 3, 5] } } };
    await authHeaders(token, profileId)(request(server()).put("/v1/profiles/current/measurement-reminders")).send(smaller).expect(200);
    const controls = await authHeaders(token, profileId)(request(server()).get("/v1/profiles/current/notification-preferences")).expect(200);
    expect(controls.body.channelFrequency).toEqual({
      refill: { channels: ["sms"], frequency: "off" },
      test_due: { channels: ["web_push", "email"], frequency: "daily_digest" },
    });

    // The plan has its own column, so the per-kind map holds kinds only —
    // a saved plan can never collide with a NotificationKind.
    const row = await prisma.notificationPreference.findUniqueOrThrow({ where: { patientProfileId: profileId } });
    expect(Object.keys(row.channelFrequencyJson as object).sort()).toEqual(["refill", "test_due"]);
    expect(row.measurementRemindersJson).toEqual(smaller);
  });

  it("an empty plan clears every reminder without touching the controls", async () => {
    await authHeaders(token, profileId)(request(server()).put("/v1/profiles/current/measurement-reminders")).send({ concepts: {} }).expect(200);
    const get = await authHeaders(token, profileId)(request(server()).get("/v1/profiles/current/measurement-reminders")).expect(200);
    expect(get.body).toEqual({ concepts: {} });
    const row = await prisma.notificationPreference.findUniqueOrThrow({ where: { patientProfileId: profileId } });
    expect(Object.keys(row.channelFrequencyJson as object).sort()).toEqual(["refill", "test_due"]);
    expect(row.measurementRemindersJson).toBeNull();
  });

  it("still reads a plan written before the column existed", async () => {
    // Pre-column rows kept the plan under a reserved key inside the per-kind
    // map. Those rows are never rewritten, so both readers must accept them.
    await prisma.notificationPreference.update({
      where: { patientProfileId: profileId },
      data: {
        measurementRemindersJson: Prisma.DbNull,
        channelFrequencyJson: {
          refill: { channels: ["sms"], frequency: "off" },
          [MEASUREMENT_REMINDERS_JSON_KEY]: { concepts: { body_weight: { times: ["07:15"], days: [1] } } },
        },
      },
    });

    const get = await authHeaders(token, profileId)(request(server()).get("/v1/profiles/current/measurement-reminders")).expect(200);
    expect(get.body).toEqual({ concepts: { body_weight: { times: ["07:15"], days: [1] } } });

    // And the reserved key still never leaks through the preferences endpoint.
    const prefsBody = await authHeaders(token, profileId)(request(server()).get("/v1/profiles/current/notification-preferences")).expect(200);
    expect(JSON.stringify(prefsBody.body)).not.toContain(MEASUREMENT_REMINDERS_JSON_KEY);
  });

  it("WhatsApp opt-in answers 501 channel_not_available until a BSP exists (OD-10)", async () => {
    const res = await authHeaders(token)(request(server()).post("/v1/notification-channels/whatsapp")).send({ phone: PHONE }).expect(501);
    expect(res.body.code).toBe("channel_not_available");
    expect(await prisma.notificationChannel.count({ where: { channel: "whatsapp" } })).toBe(0);
  });
});
