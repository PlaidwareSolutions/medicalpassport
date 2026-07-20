import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 4 follow-up e2e: the patient-set `criticalEscalation` opt-in flag
 * (docs/16 "opt-in policy" — never an inferred clinical severity) persists
 * through create/update, and a dose acknowledgement resolves *every*
 * notification tied to that scheduledDoseId, not just one — the bug fixed
 * in timeline.service.ts alongside this feature (a dose_reminder and a
 * caregiver_escalation can both exist for the same dose). The detection
 * cron (reconcile-missed-doses, extended this pass) and the caregiver-only
 * dispatch + quiet-hours bypass in detect-due-reminders were verified live
 * against a real compiled cron run rather than exercised here, matching the
 * refill/completion and SMS reminder suites' testing boundary.
 */
describe("Missed-dose caregiver escalation e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000801";
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

  it("signs in and creates a profile", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Escalation Test", yearOfBirth: 1965, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  let medicationId: string;
  let rowVersion: number;

  it("defaults criticalEscalation to false, and it can be opted into on create", async () => {
    const off = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Ordinary Tablet",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" },
      })
      .expect(201);
    expect(off.body.criticalEscalation).toBe(false);

    const on = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Critical Course Tablet",
        source: "manual",
        criticalEscalation: true,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" },
      })
      .expect(201);
    expect(on.body.criticalEscalation).toBe(true);
    medicationId = on.body.id;
    rowVersion = on.body.rowVersion;
  });

  it("toggles criticalEscalation via PATCH", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion, criticalEscalation: false })
      .expect(200);
    expect(res.body.criticalEscalation).toBe(false);
    rowVersion = res.body.rowVersion;

    const backOn = await auth(token, profileId)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion, criticalEscalation: true })
      .expect(200);
    expect(backOn.body.criticalEscalation).toBe(true);
    rowVersion = backOn.body.rowVersion;
  });

  it("recording a dose resolves every notification tied to it, not just one", async () => {
    const schedule = await prisma.medicationSchedule.findFirstOrThrow({ where: { patientMedicationId: medicationId } });
    const dose = await prisma.scheduledDose.findFirstOrThrow({ where: { medicationScheduleId: schedule.id } });

    // Simulates what a previous detect-due-reminders tick would have left
    // behind: both an ordinary dose_reminder and a caregiver_escalation
    // already sent for this same dose.
    const doseReminder = await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "dose_reminder",
        scheduledDoseId: dose.id,
        privacyMode: "generic",
        dedupeKey: `${dose.id}:reminder`,
        status: "done",
      },
    });
    const escalation = await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "caregiver_escalation",
        scheduledDoseId: dose.id,
        patientMedicationId: medicationId,
        privacyMode: "generic",
        dedupeKey: `${dose.id}:escalation`,
        status: "done",
      },
    });
    await prisma.notificationAttempt.create({
      data: { notificationId: doseReminder.id, channel: "web_push", status: "sent" },
    });
    await prisma.notificationAttempt.create({
      data: { notificationId: escalation.id, channel: "sms", status: "sent" },
    });

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken" })
      .expect(201);

    const [reminderAfter, escalationAfter] = await Promise.all([
      prisma.notification.findUniqueOrThrow({ where: { id: doseReminder.id } }),
      prisma.notification.findUniqueOrThrow({ where: { id: escalation.id } }),
    ]);
    expect(reminderAfter.status).toBe("done");
    expect(escalationAfter.status).toBe("done");

    const attempts = await prisma.notificationAttempt.findMany({
      where: { notificationId: { in: [doseReminder.id, escalation.id] } },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => a.status === "acknowledged")).toBe(true);
  });
});
