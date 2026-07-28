import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * A missed-dose caregiver_escalation notification is push/SMS-only — if
 * nobody has a live channel, detect-due-reminders.ts cancels it with
 * nothing ever shown anywhere. This closes that gap with a persistent
 * in-app record: GET /profiles/current/caregiver-alerts (reads the dose's
 * own live status, not the Notification row, so it works even when the
 * push/SMS pipeline found nobody to notify) and a hasOpenAlerts flag on
 * GET /profiles for a profile-switcher badge — both gated on the same
 * manage_reminders/full_management scope the escalation itself targets.
 */
describe("Caregiver alerts e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000851";
  const PHONE_B = "+919000000852";
  const PHONE_C = "+919000000853";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, dose_events,
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

  async function signIn(phone: string): Promise<string> {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    return verify.body.token;
  }

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let profileA: string;
  let medicationId: string;
  let doseId: string;

  it("sets up a patient, a missed dose, and two caregivers with different scopes", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Caregiver Alerts Test", yearOfBirth: 1968, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Alert Test Tablet",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);
    medicationId = med.body.id;

    const schedule = await prisma.medicationSchedule.findFirstOrThrow({ where: { patientMedicationId: medicationId } });
    const dose = await prisma.scheduledDose.findFirstOrThrow({ where: { medicationScheduleId: schedule.id }, orderBy: { dueAt: "asc" } });
    await prisma.scheduledDose.update({ where: { id: dose.id }, data: { status: "missed" } });
    doseId = dose.id;

    // B: view-only, never receives the escalation and shouldn't see the alert list either.
    tokenB = await signIn(PHONE_B);
    const inviteB = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: inviteB.body.id }).expect(201);

    // C: manage_reminders — the same scope the real escalation targets.
    tokenC = await signIn(PHONE_C);
    const inviteC = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_C, scopes: ["manage_reminders"], relationship: "child" })
      .expect(201);
    await auth(tokenC)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: inviteC.body.id }).expect(201);
  });

  it("the patient (owner) sees the missed dose in their own alert list", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregiver-alerts")).expect(200);
    const item = res.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === doseId);
    expect(item).toMatchObject({ medicationName: "Alert Test Tablet", status: "missed" });
  });

  it("a caregiver without manage_reminders/full_management is forbidden from the alert list", async () => {
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregiver-alerts")).expect(403);
  });

  it("a caregiver with manage_reminders sees the missed dose — the same audience the real escalation targets", async () => {
    const res = await auth(tokenC, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregiver-alerts")).expect(200);
    const item = res.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === doseId);
    expect(item).toMatchObject({ medicationName: "Alert Test Tablet", status: "missed" });
  });

  it("hasOpenAlerts on GET /profiles is scope-gated the same way: owner and manage_reminders caregiver see it, view-only caregiver doesn't", async () => {
    const asA = await auth(tokenA)(request(app.getHttpServer()).get("/v1/profiles")).expect(200);
    expect(asA.body.items.find((p: { id: string }) => p.id === profileA).hasOpenAlerts).toBe(true);

    const asB = await auth(tokenB)(request(app.getHttpServer()).get("/v1/profiles")).expect(200);
    expect(asB.body.items.find((p: { id: string }) => p.id === profileA).hasOpenAlerts).toBe(false);

    const asC = await auth(tokenC)(request(app.getHttpServer()).get("/v1/profiles")).expect(200);
    expect(asC.body.items.find((p: { id: string }) => p.id === profileA).hasOpenAlerts).toBe(true);
  });

  it("resolving the dose flips it to taken_other_time, still visible in the alert list, and hasOpenAlerts clears", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/doses/${doseId}/events`))
      .send({ action: "taken_other_time", effectiveAt: new Date().toISOString() })
      .expect(201);

    const alerts = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregiver-alerts")).expect(200);
    const item = alerts.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === doseId);
    expect(item).toMatchObject({ status: "taken_other_time" });

    const profiles = await auth(tokenA)(request(app.getHttpServer()).get("/v1/profiles")).expect(200);
    expect(profiles.body.items.find((p: { id: string }) => p.id === profileA).hasOpenAlerts).toBe(false);
  });

  it("a resolution older than the retention window no longer appears in the alert list", async () => {
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.scheduledDose.update({ where: { id: doseId }, data: { updatedAt: longAgo } });

    const alerts = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregiver-alerts")).expect(200);
    expect(alerts.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === doseId)).toBeUndefined();
  });
});
