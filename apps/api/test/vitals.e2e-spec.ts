import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Blood-pressure and body-weight diaries (screens 46/47): the vitals siblings
 * of the Blood Sugar Monitoring Diary, with the same view_profile/edit_profile
 * scopes and the same point-in-time + soft-delete semantics.
 */
describe("Blood pressure and weight vitals e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000871";
  const PHONE_B = "+919000000872";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, blood_pressure_readings, weight_readings,
        glucose_readings, checkup_records,
        dose_events, scheduled_doses, medication_schedules, medication_changes,
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
  let profileA: string;
  let bpId: string;
  let weightId: string;

  it("sets up a patient and a view_medications-only caregiver", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Vitals Test", yearOfBirth: 1965, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    tokenB = await signIn(PHONE_B);
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: invite.body.id }).expect(201);
  });

  it("creates and lists a blood-pressure reading; pulse stays null when not entered", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/blood-pressure-readings"))
      .send({ measuredAt: new Date().toISOString(), systolic: 128, diastolic: 84, note: "after breakfast" })
      .expect(201);
    bpId = created.body.id;

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/blood-pressure-readings")).expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === bpId)).toMatchObject({
      systolic: 128,
      diastolic: 84,
      pulseBpm: null,
      note: "after breakfast",
    });
  });

  it("records pulse when the patient enters it", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/blood-pressure-readings"))
      .send({ measuredAt: new Date().toISOString(), systolic: 122, diastolic: 80, pulseBpm: 72 })
      .expect(201);
    expect(created.body.pulseBpm).toBe(72);
  });

  it("rejects a fat-fingered blood-pressure entry (sanity bounds only)", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/blood-pressure-readings"))
      .send({ measuredAt: new Date().toISOString(), systolic: 1280, diastolic: 84 })
      .expect(400);
  });

  it("deletes the blood-pressure reading, and a second delete 404s", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/blood-pressure-readings/${bpId}`)).expect(204);

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/blood-pressure-readings")).expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === bpId)).toBeUndefined();

    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/blood-pressure-readings/${bpId}`)).expect(404);
  });

  it("creates, lists and deletes a weight reading (Decimal serialized as string)", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/weight-readings"))
      .send({ measuredAt: new Date().toISOString(), weightKg: 72.5, note: "morning" })
      .expect(201);
    weightId = created.body.id;

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/weight-readings")).expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === weightId);
    expect(Number(item.weightKg)).toBeCloseTo(72.5);
    expect(item.note).toBe("morning");

    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/weight-readings/${weightId}`)).expect(204);
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/weight-readings/${weightId}`)).expect(404);
  });

  it("a caregiver with only view_medications can GET but not POST/DELETE", async () => {
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/blood-pressure-readings")).expect(200);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/weight-readings")).expect(200);

    await auth(tokenB, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/blood-pressure-readings"))
      .send({ measuredAt: new Date().toISOString(), systolic: 120, diastolic: 80 })
      .expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/weight-readings"))
      .send({ measuredAt: new Date().toISOString(), weightKg: 70 })
      .expect(403);

    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/weight-readings"))
      .send({ measuredAt: new Date().toISOString(), weightKg: 71 })
      .expect(201);
    await auth(tokenB, profileA)(request(app.getHttpServer()).delete(`/v1/weight-readings/${created.body.id}`)).expect(403);
  });

  it("the visit summary carries both sections with window aggregates", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/blood-pressure-readings"))
      .send({ measuredAt: new Date().toISOString(), systolic: 130, diastolic: 85, pulseBpm: 70 })
      .expect(201);
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/weight-readings"))
      .send({ measuredAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), weightKg: 70.0 })
      .expect(201);

    const summary = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/visit-summary")).expect(200);
    const bp = summary.body.bloodPressureReadings;
    expect(bp.readingCount).toBeGreaterThanOrEqual(2);
    expect(bp.averageSystolic).toBeGreaterThan(0);
    expect(bp.recent[0]).toMatchObject({ systolic: 130, diastolic: 85, pulseBpm: 70 });

    const w = summary.body.weightReadings;
    expect(w.readingCount).toBeGreaterThanOrEqual(2);
    expect(Number(w.latestKg)).toBeGreaterThan(0);
    // changeKg is plain latest-minus-earliest arithmetic, present once ≥2 readings exist.
    expect(w.changeKg).not.toBeNull();
  });
});
