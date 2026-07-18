import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 4 follow-up e2e: patient-entered supply tracking (quantityOnHand),
 * auto-decrement on a recorded dose, the "mark refilled" action, and the
 * refill/completion reminders list + dismiss endpoints (docs/07 screen 27).
 * The detection cron (generate-refill-reminders) and the generalized
 * dispatch pass in detect-due-reminders were verified live against a real
 * compiled cron run rather than exercised here — this suite covers the API
 * surface and DB-side effects those crons both depend on and produce.
 */
describe("Refill & completion reminders e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000701";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, notification_attempts, notifications,
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

  it("signs in and creates a profile", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Refill Test", yearOfBirth: 1970, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  let medicationId: string;
  let rowVersion: number;

  it("creates a medicine with a patient-entered supply snapshot", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Refill Test Tablet",
        source: "manual",
        quantityOnHand: 10,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" },
      })
      .expect(201);
    expect(res.body.quantityOnHand).toBe("10");
    medicationId = res.body.id;
    rowVersion = res.body.rowVersion;
  });

  it("auto-decrements the supply snapshot when a dose is actually taken", async () => {
    const schedule = await prisma.medicationSchedule.findFirstOrThrow({ where: { patientMedicationId: medicationId } });
    const dose = await prisma.scheduledDose.findFirstOrThrow({ where: { medicationScheduleId: schedule.id } });

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken" })
      .expect(201);

    const detail = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(detail.body.quantityOnHand).toBe("9"); // 10 - 1 (doseQuantity)
    rowVersion = detail.body.rowVersion;

    // Skipped/could-not-take doses must never decrement — only real consumption.
    const dose2 = await prisma.scheduledDose.findFirstOrThrow({
      where: { medicationScheduleId: schedule.id, id: { not: dose.id } },
    });
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose2.id}/events`))
      .send({ action: "skipped" })
      .expect(201);
    const afterSkip = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(afterSkip.body.quantityOnHand).toBe("9");
  });

  it("edits the supply snapshot directly via PATCH", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion, quantityOnHand: 4 })
      .expect(200);
    expect(res.body.quantityOnHand).toBe("4");
    rowVersion = res.body.rowVersion;
  });

  let refillNotificationId: string;

  it("lists an active refill reminder with a computed days-remaining estimate", async () => {
    // Simulates what generate-refill-reminders would have created: BD (2/day)
    // with 4 tablets on hand → 2 days remaining, at/under any real threshold.
    const notification = await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "refill",
        patientMedicationId: medicationId,
        privacyMode: "generic",
        dedupeKey: `refill:${medicationId}:4`,
        status: "pending",
      },
    });
    refillNotificationId = notification.id;

    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/refill-reminders")).expect(
      200,
    );
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item.kind).toBe("refill");
    expect(item.patientMedicationId).toBe(medicationId);
    expect(item.quantityOnHand).toBe("4");
    expect(item.daysRemainingEstimate).toBe(2); // 4 / (1 * 2 slots per day)
    expect(item.estimatedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("marking refilled updates the supply, records a distinct audit action, and resolves the reminder", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/medications/${medicationId}/refill`))
      .send({ rowVersion, quantityOnHand: 30 })
      .expect(201);

    const detail = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(detail.body.quantityOnHand).toBe("30");
    rowVersion = detail.body.rowVersion;

    const audit = await prisma.auditEvent.findFirst({
      where: { patientProfileId: profileId, action: "medication.refill_recorded" },
    });
    expect(audit).toBeTruthy();

    const change = await prisma.medicationChange.findFirst({
      where: { patientMedicationId: medicationId, change: "refilled" },
    });
    expect(change).toBeTruthy();

    const resolved = await prisma.notification.findUniqueOrThrow({ where: { id: refillNotificationId } });
    expect(resolved.status).toBe("cancelled");

    const list = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/refill-reminders")).expect(
      200,
    );
    expect(list.body.items).toHaveLength(0);
  });

  let completionNotificationId: string;

  it("lists an active completion reminder with the expected end date", async () => {
    const med = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Course Test Tablet",
        source: "manual",
        startDate: "2026-07-10",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "TDS", durationDays: 5 },
      })
      .expect(201);

    const notification = await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "completion",
        patientMedicationId: med.body.id,
        privacyMode: "generic",
        dedupeKey: `completion:${med.body.id}:2026-07-15`,
        status: "pending",
      },
    });
    completionNotificationId = notification.id;

    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/refill-reminders")).expect(
      200,
    );
    const item = res.body.items.find((i: { kind: string }) => i.kind === "completion");
    expect(item).toBeTruthy();
    expect(item.estimatedDate).toBe("2026-07-15"); // startDate + durationDays
    expect(item.daysRemainingEstimate).toBeNull();

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/medications/${med.body.id}/status`))
      .send({ rowVersion: med.body.rowVersion, status: "completed" })
      .expect(201);

    const resolved = await prisma.notification.findUniqueOrThrow({ where: { id: completionNotificationId } });
    expect(resolved.status).toBe("cancelled");
  });

  it("dismisses a reminder without acting on it", async () => {
    const notification = await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "refill",
        patientMedicationId: medicationId,
        privacyMode: "generic",
        dedupeKey: `refill:${medicationId}:dismiss-test`,
        status: "pending",
      },
    });

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/refill-reminders/${notification.id}/dismiss`)).expect(
      201,
    );

    const resolved = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(resolved.status).toBe("cancelled");

    const audit = await prisma.auditEvent.findFirst({
      where: { patientProfileId: profileId, action: "notification.dismissed", entityId: notification.id },
    });
    expect(audit).toBeTruthy();

    const list = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/refill-reminders")).expect(
      200,
    );
    expect(list.body.items).toHaveLength(0);
  });
});
