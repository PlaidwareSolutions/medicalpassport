import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Confirm-your-medicine-type (docs/07 screen 9).
 *
 * Until 2026-07-25 the app hardcoded `doseUnit: "tablet"` on every save, so
 * historic instructions carry a unit nobody chose. Invisible while the unit
 * was only text; not invisible now the medicines list draws it as a picture.
 * These cover the flag, the one-tap confirm, and the correction path.
 */
describe("Dose unit confirmation e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000931";
  const PHONE_B = "+919000000932";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, dose_events, scheduled_doses,
        medication_schedules, medication_changes, medication_instructions,
        patient_medications, practitioners, patient_allergies, patient_conditions,
        consent_events, consents, caregiver_permissions, caregiver_relationships,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
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
    await prisma.otpAttempt.deleteMany({});
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    return verify.body.token;
  }

  let tokenA: string;
  let tokenB: string;
  let profileA: string;
  let legacyId: string;

  it("sets up a patient and a view_medications-only caregiver", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Dose Unit Test", yearOfBirth: 1958, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    tokenB = await signIn(PHONE_B);
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: invite.body.id }).expect(201);
  });

  it("marks a newly added medicine as confirmed — every client path now asks the type", async () => {
    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Newly Added",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "ml", frequencyCode: "OD" },
      })
      .expect(201);
    expect(med.body.instruction.doseUnitConfirmed).toBe(true);
  });

  it("reports a legacy instruction as unconfirmed", async () => {
    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Legacy Syrup",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);
    legacyId = med.body.id;

    // Reproduce a pre-2026-07-25 row: the unit was written without anyone
    // being asked, which is exactly what the backfill leaves null.
    await prisma.medicationInstruction.updateMany({
      where: { patientMedicationId: legacyId, supersededAt: null },
      data: { doseUnitConfirmedAt: null },
    });

    const fresh = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${legacyId}`)).expect(200);
    expect(fresh.body.instruction.doseUnitConfirmed).toBe(false);
  });

  it("confirming the same unit records the answer without inventing a history entry", async () => {
    const before = await prisma.medicationInstruction.count({ where: { patientMedicationId: legacyId } });

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/medications/${legacyId}/confirm-dose-unit`))
      .send({ doseUnit: "tablet" })
      .expect(201);
    expect(res.body.instruction).toMatchObject({ doseUnit: "tablet", doseUnitConfirmed: true });

    // Nothing clinical changed, so no superseding copy — a duplicate row here
    // would pad the medicine's history with a non-event.
    expect(await prisma.medicationInstruction.count({ where: { patientMedicationId: legacyId } })).toBe(before);
  });

  it("correcting the unit supersedes the old instruction instead of overwriting it", async () => {
    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Actually A Syrup",
        source: "manual",
        instruction: { doseQuantity: 5, doseUnit: "tablet", frequencyCode: "TDS" },
      })
      .expect(201);
    await prisma.medicationInstruction.updateMany({
      where: { patientMedicationId: med.body.id, supersededAt: null },
      data: { doseUnitConfirmedAt: null },
    });

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/medications/${med.body.id}/confirm-dose-unit`))
      .send({ doseUnit: "ml" })
      .expect(201);
    expect(res.body.instruction).toMatchObject({ doseUnit: "ml", doseUnitConfirmed: true });
    // The dose itself is untouched — confirming a type must never quietly
    // become a route to editing a clinical value.
    expect(res.body.instruction.doseQuantity).toBe("5");
    expect(res.body.instruction.frequencyCode).toBe("TDS");

    const rows = await prisma.medicationInstruction.findMany({
      where: { patientMedicationId: med.body.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.doseUnit).toBe("tablet");
    expect(rows[0]!.supersededAt).not.toBeNull();
    expect(rows[1]!.supersededAt).toBeNull();
  });

  it("rejects a unit that isn't a real medicine type", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/medications/${legacyId}/confirm-dose-unit`))
      .send({ doseUnit: "spoonful" })
      .expect(400);
  });

  it("a caregiver with only view_medications can see the flag but not answer it", async () => {
    const read = await auth(tokenB, profileA)(request(app.getHttpServer()).get(`/v1/medications/${legacyId}`)).expect(200);
    expect(read.body.instruction).toHaveProperty("doseUnitConfirmed");

    await auth(tokenB, profileA)(request(app.getHttpServer()).post(`/v1/medications/${legacyId}/confirm-dose-unit`))
      .send({ doseUnit: "capsule" })
      .expect(403);
  });

  it("404s for a medicine on someone else's profile", async () => {
    await auth(tokenA, profileA)(
      request(app.getHttpServer()).post("/v1/medications/00000000-0000-4000-8000-000000000000/confirm-dose-unit"),
    )
      .send({ doseUnit: "tablet" })
      .expect(404);
  });
});
