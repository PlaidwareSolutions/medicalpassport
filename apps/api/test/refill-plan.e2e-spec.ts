import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Phase 2 (docs_v2/04 §4.1, docs_v2/05 §4): the refill plan and the two
 * medication links that answer "why am I taking it" and "who prescribed it".
 *
 * What these pin down:
 *  - the plan is a *projection* of the patient's own numbers (what they hold
 *    ÷ what the confirmed schedule uses), never advice to buy;
 *  - reading never creates a row, so a patient who only ever used the bare
 *    counter still sees a projection (`exists: false`);
 *  - the plan and `PatientMedication.quantityOnHand` never disagree while
 *    both exist — a write to either syncs the other;
 *  - a condition or doctor belonging to someone else is a 400, never a
 *    silent link, and a label that has since gone is dropped rather than
 *    shown as a bare id.
 */
describe("Refill plan and medication links e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000981";
  const PHONE_B = "+919000000982";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, dose_events,
        scheduled_doses, medication_schedules, medication_changes,
        medication_refill_plans, medication_instructions, patient_medications,
        practitioners, prescriptions, medical_reports, patient_allergies,
        patient_conditions, consent_events, consents, caregiver_permissions,
        caregiver_relationships, sessions, user_devices, otp_attempts,
        patient_profiles, users CASCADE
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
    return verify.body.token as string;
  }

  async function createProfile(token: string, displayName: string): Promise<string> {
    const res = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName, yearOfBirth: 1968, preferredLocale: "en" })
      .expect(201);
    return res.body.id as string;
  }

  let tokenA: string;
  let profileA: string;
  let medicationId: string;
  let tokenB: string;

  it("sets up a patient with a twice-daily medicine and 30 tablets on hand", async () => {
    tokenA = await signIn(PHONE_A);
    profileA = await createProfile(tokenA, "Refill Test Patient");

    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .set("idempotency-key", randomUUID())
      .send({
        enteredName: "Metformin 500",
        source: "manual",
        quantityOnHand: 30,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", foodInstruction: "after" },
      })
      .expect(201);
    medicationId = med.body.id;
    expect(med.body.quantityOnHand).toBe("30");
  });

  it("projects a run-out date from the confirmed schedule without creating a plan row", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}/refill-plan`)).expect(200);

    // Nothing was stored: the bare counter is still the only record.
    expect(res.body.exists).toBe(false);
    expect(res.body.packSize).toBeNull();
    expect(res.body.quantityOnHand).toBe("30");
    // BD = two doses of one tablet a day, so 30 tablets last 15 days.
    expect(Number(res.body.dailyConsumption)).toBe(2);
    expect(res.body.projectedRunOutOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await prisma.medicationRefillPlan.count({ where: { patientMedicationId: medicationId } })).toBe(0);
  });

  it("stores a pack size and keeps the medicine's own counter in step", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).put(`/v1/medications/${medicationId}/refill-plan`))
      .send({ packSize: 15, quantityOnHand: 10 })
      .expect(200);

    expect(res.body.exists).toBe(true);
    expect(res.body.packSize).toBe("15");
    expect(res.body.quantityOnHand).toBe("10");
    expect(Number(res.body.dailyConsumption)).toBe(2);

    const medication = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });
    expect(String(medication.quantityOnHand)).toBe("10");
    const audit = await prisma.auditEvent.findFirst({ where: { action: "medication.refill_plan_updated", entityId: medicationId } });
    expect(audit).not.toBeNull();
    // The quantity itself is never in the audit context — flags only.
    expect(JSON.stringify(audit?.context)).not.toContain("10");
  });

  it("mirrors a 'mark refilled' back into the plan", async () => {
    const medication = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/medications/${medicationId}/refill`))
      .send({ quantityOnHand: 60, rowVersion: medication.rowVersion })
      .expect(201);

    const plan = await prisma.medicationRefillPlan.findUniqueOrThrow({ where: { patientMedicationId: medicationId } });
    expect(String(plan.quantityOnHand)).toBe("60");
    // 60 tablets at two a day: the projection moved out, not the pack size.
    expect(String(plan.packSize)).toBe("15");
  });

  it("links the medicine to one of this profile's conditions and doctors", async () => {
    const condition = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/conditions"))
      .send({ label: "Type 2 diabetes" })
      .expect(201);
    const doctor = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/practitioners"))
      .send({ displayName: "Dr. Ramachandran" })
      .expect(201);
    const medication = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medication.rowVersion, reasonConditionId: condition.body.id, prescribingPractitionerId: doctor.body.id })
      .expect(200);

    expect(res.body.reasonCondition).toEqual({ id: condition.body.id, label: "Type 2 diabetes" });
    expect(res.body.prescribingPractitioner).toEqual({ id: doctor.body.id, displayName: "Dr. Ramachandran" });
  });

  it("supersedes the instruction rather than editing it when route or strength change", async () => {
    const before = await prisma.medicationInstruction.count({ where: { patientMedicationId: medicationId } });
    const medication = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });

    await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medication.rowVersion, routeText: "by mouth", strengthLabel: "500 mg" })
      .expect(200);

    const after = await prisma.medicationInstruction.findMany({
      where: { patientMedicationId: medicationId },
      orderBy: { createdAt: "desc" },
    });
    expect(after.length).toBe(before + 1);
    // The new row carries the change; the old one is kept, marked superseded.
    expect(after[0]?.routeText).toBe("by mouth");
    expect(after[0]?.strengthLabel).toBe("500 mg");
    expect(after[0]?.supersededAt).toBeNull();
    expect(after[1]?.supersededAt).not.toBeNull();
    // The dose itself is carried over untouched — this was not a dose change.
    expect(String(after[0]?.doseQuantity)).toBe(String(after[1]?.doseQuantity));
    expect(after[0]?.frequencyCode).toBe(after[1]?.frequencyCode);
  });

  it("refuses a condition or doctor belonging to another patient", async () => {
    tokenB = await signIn(PHONE_B);
    const profileB = await createProfile(tokenB, "Someone Else");
    const foreignCondition = await auth(tokenB, profileB)(request(app.getHttpServer()).post("/v1/profiles/current/conditions"))
      .send({ label: "Asthma" })
      .expect(201);

    const medication = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medication.rowVersion, reasonConditionId: foreignCondition.body.id });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_failed");
    // The link was not made.
    const after = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });
    expect(after.reasonConditionId).not.toBe(foreignCondition.body.id);
  });

  it("drops a link whose record has since been deleted instead of showing a bare id", async () => {
    const medication = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });
    expect(medication.reasonConditionId).not.toBeNull();
    await prisma.patientCondition.update({ where: { id: medication.reasonConditionId! }, data: { deletedAt: new Date() } });

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(res.body.reasonCondition).toBeNull();
    // The doctor is untouched and still resolves.
    expect(res.body.prescribingPractitioner?.displayName).toBe("Dr. Ramachandran");
  });

  it("does not let another patient read this medicine's refill plan", async () => {
    // Reuses the session from the cross-profile test above: a second OTP
    // round for the same number would hit the per-number send cap.
    const profiles = await auth(tokenB)(request(app.getHttpServer()).get("/v1/profiles")).expect(200);
    const profileB = profiles.body.items[0].id;
    const res = await auth(tokenB, profileB)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}/refill-plan`));
    expect(res.status).toBe(404);
  });
});
