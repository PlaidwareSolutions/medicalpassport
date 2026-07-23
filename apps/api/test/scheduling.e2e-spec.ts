import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 4 e2e: schedule derivation from a confirmed instruction, the daily
 * timeline, dose recording (taken/snooze/idempotency), PRN dosing, and
 * pause/resume regenerating the rolling window.
 */
describe("Scheduling e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000101";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, offline_mutations, medication_changes,
        medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  function istDateString(daysFromNow = 0): string {
    const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000 + daysFromNow * 86_400_000);
    return d.toISOString().slice(0, 10);
  }

  let token: string;
  let profileId: string;
  let bdMedicationId: string;

  it("signs in and creates a profile", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Scheduling Test", preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  it("auto-derives a schedule for a BD medicine and materializes today's doses", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Test BD Medicine",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", foodInstruction: "after" },
      })
      .expect(201);
    bdMedicationId = res.body.id;

    const timeline = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${istDateString()}`),
    ).expect(200);
    const slots = timeline.body.items.map((i: { slotLabel: string; status: string }) => [i.slotLabel, i.status]);
    expect(slots).toEqual(expect.arrayContaining([
      ["morning", "upcoming"],
      ["night", "upcoming"],
    ]));
    expect(timeline.body.items).toHaveLength(2);

    // 14-day rolling window materialized up front (docs/16).
    const schedule = await prisma.medicationSchedule.findUniqueOrThrow({
      where: { patientMedicationId: bdMedicationId },
    });
    const doseCount = await prisma.scheduledDose.count({ where: { medicationScheduleId: schedule.id } });
    expect(doseCount).toBe(28); // 14 days × 2 slots
  });

  it("records a dose as taken, idempotently", async () => {
    const timeline = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${istDateString()}`),
    ).expect(200);
    const morning = timeline.body.items.find((i: { slotLabel: string }) => i.slotLabel === "morning");
    const key = "22222222-2222-4222-8222-222222222222";

    const first = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/doses/${morning.scheduledDoseId}/events`),
    )
      .send({ action: "taken", clientMutationId: key })
      .expect(201);
    expect(first.body.status).toBe("taken");

    // Exact replay resolves to the same event, no duplicate row.
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${morning.scheduledDoseId}/events`))
      .send({ action: "taken", clientMutationId: key })
      .expect(201);
    const eventCount = await prisma.doseEvent.count({ where: { scheduledDoseId: morning.scheduledDoseId } });
    expect(eventCount).toBe(1);

    const after = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${istDateString()}`),
    ).expect(200);
    const updated = after.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === morning.scheduledDoseId);
    expect(updated.status).toBe("taken");
  });

  it("snoozes a dose and shows it due again once the snooze elapses", async () => {
    const timeline = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${istDateString()}`),
    ).expect(200);
    const night = timeline.body.items.find((i: { slotLabel: string }) => i.slotLabel === "night");

    const snoozed = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/doses/${night.scheduledDoseId}/events`),
    )
      .send({ action: "snoozed", snoozeMinutes: 10 })
      .expect(201);
    expect(snoozed.body.status).toBe("snoozed");

    // Simulate the snooze period elapsing.
    await prisma.scheduledDose.update({
      where: { id: night.scheduledDoseId },
      data: { snoozedUntil: new Date(Date.now() - 1000) },
    });

    const after = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${istDateString()}`),
    ).expect(200);
    const updated = after.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === night.scheduledDoseId);
    expect(updated.status).toBe("snoozed");
    expect(updated.isDueNow).toBe(true);
  });

  it("never auto-schedules a PRN (SOS) medicine, and records PRN dose events separately", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Test PRN Medicine",
        source: "manual",
        isPrn: true,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "SOS" },
      })
      .expect(201);
    const prnMedicationId = res.body.id;

    const schedule = await prisma.medicationSchedule.findUnique({ where: { patientMedicationId: prnMedicationId } });
    expect(schedule).toBeNull();

    const event = await auth(token, profileId)(
      request(app.getHttpServer()).post("/v1/profiles/current/doses/prn-events"),
    )
      .send({ patientMedicationId: prnMedicationId, action: "taken" })
      .expect(201);
    expect(event.body.id).toBeTruthy();

    const stored = await prisma.doseEvent.findUnique({ where: { id: event.body.id } });
    expect(stored?.scheduledDoseId).toBeNull();
  });

  it("auto-schedules a WEEKLY medicine anchored to its start date, 2 occurrences in the 14-day window", async () => {
    const today = istDateString();
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Test Weekly Medicine",
        source: "manual",
        startDate: today,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "WEEKLY" },
      })
      .expect(201);
    const medicationId = res.body.id;

    const schedule = await prisma.medicationSchedule.findUniqueOrThrow({
      where: { patientMedicationId: medicationId },
    });
    expect(schedule.recurrence).toBe("weekly");
    expect(schedule.anchorDate?.toISOString().slice(0, 10)).toBe(today);

    const doses = await prisma.scheduledDose.findMany({
      where: { medicationScheduleId: schedule.id },
      orderBy: { dueAt: "asc" },
    });
    // Anchor day (0) and day 7 fall inside [today, today+14); day 14 doesn't.
    expect(doses).toHaveLength(2);
    expect(doses.every((d) => d.slotLabel === "morning")).toBe(true);
    expect(doses[0]!.dueAt.toISOString().slice(0, 10)).toBe(istDateString(0));
    expect(doses[1]!.dueAt.toISOString().slice(0, 10)).toBe(istDateString(7));

    const timelineToday = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${today}`),
    ).expect(200);
    expect(timelineToday.body.items.some((i: { scheduledDoseId: string }) => i.scheduledDoseId === doses[0]!.id)).toBe(
      true,
    );

    // An off-cycle day gets no dose for THIS schedule specifically (other
    // medicines in this shared test profile, e.g. the BD one above, may
    // still have their own doses due that same day).
    const offCycleDay = istDateString(3);
    const offCycleDose = await prisma.scheduledDose.findFirst({
      where: {
        medicationScheduleId: schedule.id,
        dueAt: {
          gte: new Date(`${offCycleDay}T00:00:00+05:30`),
          lt: new Date(`${istDateString(4)}T00:00:00+05:30`),
        },
      },
    });
    expect(offCycleDose).toBeNull();
  });

  it("auto-schedules a FORTNIGHTLY medicine, 1 occurrence in the 14-day window", async () => {
    const today = istDateString();
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Test Fortnightly Medicine",
        source: "manual",
        startDate: today,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "FORTNIGHTLY" },
      })
      .expect(201);
    const medicationId = res.body.id;

    const schedule = await prisma.medicationSchedule.findUniqueOrThrow({
      where: { patientMedicationId: medicationId },
    });
    expect(schedule.recurrence).toBe("fortnightly");

    const doses = await prisma.scheduledDose.findMany({ where: { medicationScheduleId: schedule.id } });
    // Only the anchor day (0) falls inside [today, today+14); day 14 doesn't.
    expect(doses).toHaveLength(1);
    expect(doses[0]!.dueAt.toISOString().slice(0, 10)).toBe(today);
  });

  it("auto-schedules a MONTHLY medicine anchored to its start date's day-of-month", async () => {
    const today = istDateString();
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Test Monthly Medicine",
        source: "manual",
        startDate: today,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "MONTHLY" },
      })
      .expect(201);
    const medicationId = res.body.id;

    const schedule = await prisma.medicationSchedule.findUniqueOrThrow({
      where: { patientMedicationId: medicationId },
    });
    expect(schedule.recurrence).toBe("monthly");

    const doses = await prisma.scheduledDose.findMany({ where: { medicationScheduleId: schedule.id } });
    // Next month's occurrence is well outside the 14-day rolling window.
    expect(doses).toHaveLength(1);
    expect(doses[0]!.dueAt.toISOString().slice(0, 10)).toBe(today);
  });

  it("editing a medicine's startDate moves a WEEKLY schedule's anchor", async () => {
    // Anchored to tomorrow, not today: cancelFutureUpcomingDoses only ever
    // clears doses with dueAt in the future (by design — a dose whose time
    // already passed is left for missed-dose reconciliation, never silently
    // deleted). Anchoring at "today" would materialize a dose at today's
    // slot time, which is already in the past whenever this suite happens
    // to run after that time of day, and it would survive the anchor-move
    // regeneration below as a stale extra row — a real flake, not a bug in
    // the app. Anchoring at tomorrow keeps every date in this test safely
    // in the future regardless of what time of day the suite runs.
    const startAnchor = istDateString(1);
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Test Weekly Anchor Move",
        source: "manual",
        startDate: startAnchor,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "WEEKLY" },
      })
      .expect(201);
    const medicationId = res.body.id;
    const medBefore = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });

    const newAnchor = istDateString(3);
    await auth(token, profileId)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medBefore.rowVersion, startDate: newAnchor })
      .expect(200);

    const schedule = await prisma.medicationSchedule.findUniqueOrThrow({
      where: { patientMedicationId: medicationId },
    });
    expect(schedule.anchorDate?.toISOString().slice(0, 10)).toBe(newAnchor);
    const doses = await prisma.scheduledDose.findMany({
      where: { medicationScheduleId: schedule.id },
      orderBy: { dueAt: "asc" },
    });
    // New anchor (today+3) and new anchor+7 (today+10) both still fall
    // inside the [today, today+14) window.
    expect(doses).toHaveLength(2);
    expect(doses[0]!.dueAt.toISOString().slice(0, 10)).toBe(newAnchor);
    expect(doses[1]!.dueAt.toISOString().slice(0, 10)).toBe(istDateString(10));
  });

  it("clears future doses on pause and regenerates them on resume", async () => {
    const tomorrow = istDateString(1);
    const beforePause = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${tomorrow}`),
    ).expect(200);
    expect(beforePause.body.items.length).toBe(2);

    const medBefore = await prisma.patientMedication.findUniqueOrThrow({ where: { id: bdMedicationId } });
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/medications/${bdMedicationId}/status`))
      .send({ rowVersion: medBefore.rowVersion, status: "paused", reason: "test pause" })
      .expect(201);

    const duringPause = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${tomorrow}`),
    ).expect(200);
    expect(duringPause.body.items).toHaveLength(0);

    const medPaused = await prisma.patientMedication.findUniqueOrThrow({ where: { id: bdMedicationId } });
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/medications/${bdMedicationId}/status`))
      .send({ rowVersion: medPaused.rowVersion, status: "current" })
      .expect(201);

    const afterResume = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${tomorrow}`),
    ).expect(200);
    expect(afterResume.body.items).toHaveLength(2);
    expect(afterResume.body.items.every((i: { status: string }) => i.status === "upcoming")).toBe(true);
  });
});
