import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * A patient who genuinely took a dose but forgot to tap "Taken" in time gets
 * marked `missed` by reconcile-missed-doses.ts, and any caregiver holding
 * `manage_reminders` gets escalated to. This covers the fix: a missed dose
 * can be corrected via the existing `taken_other_time` action, and — only
 * when a caregiver escalation had genuinely already been dispatched for that
 * dose — a `dose_correction` Notification is queued so the same caregivers
 * learn it was a false alarm (TimelineService.recordDoseEvent). Dispatch
 * itself (detect-due-reminders.ts) is exercised live rather than here,
 * matching the sibling missed-dose-escalation suite's testing boundary.
 */
describe("Missed-dose correction e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000802";
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
  let medicationId: string;
  let scheduleId: string;

  it("signs in, creates a profile and a medicine", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Correction Test", yearOfBirth: 1970, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;

    const medication = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Correction Test Tablet",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" },
      })
      .expect(201);
    medicationId = medication.body.id;

    const schedule = await prisma.medicationSchedule.findFirstOrThrow({ where: { patientMedicationId: medicationId } });
    scheduleId = schedule.id;
  });

  /** Creates a fresh scheduled dose in the given status, independent of whatever extend-scheduled-doses.ts already generated. */
  async function makeDose(status: "upcoming" | "missed", dueAt: Date) {
    return prisma.scheduledDose.create({
      data: { medicationScheduleId: scheduleId, dueAt, slotLabel: "morning", quantity: 1, status },
    });
  }

  it("taken_other_time on a dose that was never missed sends no correction notice", async () => {
    const dose = await makeDose("upcoming", new Date(Date.now() - 60 * 60_000));

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken_other_time", effectiveAt: new Date(Date.now() - 30 * 60_000).toISOString() })
      .expect(201);

    const corrections = await prisma.notification.findMany({ where: { scheduledDoseId: dose.id, kind: "dose_correction" } });
    expect(corrections).toHaveLength(0);
  });

  it("correcting a missed dose with no escalation ever sent creates no correction notice", async () => {
    const dose = await makeDose("missed", new Date(Date.now() - 3 * 60 * 60_000));

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken_other_time", effectiveAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() })
      .expect(201);

    const corrections = await prisma.notification.findMany({ where: { scheduledDoseId: dose.id, kind: "dose_correction" } });
    expect(corrections).toHaveLength(0);
  });

  it("correcting a missed dose whose escalation only ever failed to send creates no correction notice", async () => {
    const dose = await makeDose("missed", new Date(Date.now() - 3 * 60 * 60_000));
    const escalation = await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "caregiver_escalation",
        scheduledDoseId: dose.id,
        patientMedicationId: medicationId,
        privacyMode: "generic",
        dedupeKey: `${dose.id}:escalation`,
        status: "cancelled",
      },
    });
    await prisma.notificationAttempt.create({
      data: { notificationId: escalation.id, channel: "sms", status: "failed", errorDigest: "telnyx_40001: not routable" },
    });

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken_other_time", effectiveAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() })
      .expect(201);

    const corrections = await prisma.notification.findMany({ where: { scheduledDoseId: dose.id, kind: "dose_correction" } });
    expect(corrections).toHaveLength(0);
  });

  it("marking a missed dose as taken via 'taken' (not taken_other_time) sends no correction notice", async () => {
    const dose = await makeDose("missed", new Date(Date.now() - 3 * 60 * 60_000));
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
    await prisma.notificationAttempt.create({ data: { notificationId: escalation.id, channel: "sms", status: "sent" } });

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken" })
      .expect(201);

    const corrections = await prisma.notification.findMany({ where: { scheduledDoseId: dose.id, kind: "dose_correction" } });
    expect(corrections).toHaveLength(0);
  });

  it("correcting a missed dose whose escalation was actually sent notifies caregivers", async () => {
    const dose = await makeDose("missed", new Date(Date.now() - 3 * 60 * 60_000));
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
    await prisma.notificationAttempt.create({ data: { notificationId: escalation.id, channel: "sms", status: "sent" } });

    const effectiveAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const res = await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken_other_time", effectiveAt })
      .expect(201);
    expect(res.body.status).toBe("taken_other_time");

    const doseAfter = await prisma.scheduledDose.findUniqueOrThrow({ where: { id: dose.id } });
    expect(doseAfter.status).toBe("taken_other_time");

    const escalationAfter = await prisma.notification.findUniqueOrThrow({ where: { id: escalation.id } });
    expect(escalationAfter.status).toBe("done");

    const correction = await prisma.notification.findFirst({ where: { scheduledDoseId: dose.id, kind: "dose_correction" } });
    expect(correction).not.toBeNull();
    expect(correction!.status).toBe("pending");
    expect(correction!.patientMedicationId).toBe(medicationId);
    expect(correction!.dedupeKey).toBe(`${dose.id}:correction`);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "dose.correction_notice_created", entityId: dose.id } });
    expect(audit).not.toBeNull();
  });

  it("never creates a second correction notice for the same dose", async () => {
    const dose = await makeDose("missed", new Date(Date.now() - 3 * 60 * 60_000));
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
    await prisma.notificationAttempt.create({ data: { notificationId: escalation.id, channel: "sms", status: "sent" } });
    // Simulates a correction notice already queued by a previous request for this same dose.
    await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "dose_correction",
        scheduledDoseId: dose.id,
        patientMedicationId: medicationId,
        privacyMode: "generic",
        dedupeKey: `${dose.id}:correction`,
        status: "pending",
      },
    });

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken_other_time", effectiveAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString() })
      .expect(201);

    const corrections = await prisma.notification.findMany({ where: { scheduledDoseId: dose.id, kind: "dose_correction" } });
    expect(corrections).toHaveLength(1);
  });
});
