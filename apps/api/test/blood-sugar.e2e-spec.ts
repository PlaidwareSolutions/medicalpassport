import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Blood Sugar Monitoring Diary (docs/07 screen 42): glucose readings and
 * periodic check-up records. Same view_profile/edit_profile scopes as
 * allergies/conditions — no dedicated scope exists for simple
 * patient-self-reported data anywhere in this app.
 */
describe("Blood sugar monitoring e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000861";
  const PHONE_B = "+919000000862";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, glucose_readings, checkup_records,
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
  let readingId: string;
  let checkupId: string;

  it("sets up a patient and a view_medications-only caregiver", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Blood Sugar Test", yearOfBirth: 1970, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    tokenB = await signIn(PHONE_B);
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: invite.body.id }).expect(201);
  });

  it("creates and lists a glucose reading", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/glucose-readings"))
      .send({ measuredAt: new Date().toISOString(), context: "before_breakfast", valueMgDl: 110, note: "felt fine" })
      .expect(201);
    readingId = created.body.id;

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/glucose-readings")).expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === readingId)).toMatchObject({
      context: "before_breakfast",
      valueMgDl: 110,
      note: "felt fine",
    });
  });

  it("deletes the glucose reading, and a second delete 404s", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/glucose-readings/${readingId}`)).expect(204);

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/glucose-readings")).expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === readingId)).toBeUndefined();

    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/glucose-readings/${readingId}`)).expect(404);
  });

  it("creates a check-up record with only some fields filled in — the rest stay null, never fabricated", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/checkup-records"))
      .send({ checkupDate: new Date().toISOString(), fastingGlucoseMgDl: 95, hba1cPercent: 6.2 })
      .expect(201);
    checkupId = created.body.id;

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/checkup-records")).expect(200);
    const item = list.body.items.find((i: { id: string }) => i.id === checkupId);
    expect(item).toMatchObject({ fastingGlucoseMgDl: 95 });
    expect(Number(item.hba1cPercent)).toBeCloseTo(6.2);
    expect(item.postPrandialGlucoseMgDl).toBeNull();
    expect(item.bloodPressureSystolic).toBeNull();
    expect(item.treatmentChanges).toBeNull();
  });

  it("deletes the check-up record, and a second delete 404s", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/checkup-records/${checkupId}`)).expect(204);
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/checkup-records/${checkupId}`)).expect(404);
  });

  it("a caregiver with only view_medications can GET but not POST/DELETE", async () => {
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/glucose-readings")).expect(200);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/checkup-records")).expect(200);

    await auth(tokenB, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/glucose-readings"))
      .send({ measuredAt: new Date().toISOString(), context: "random", valueMgDl: 100 })
      .expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/checkup-records"))
      .send({ checkupDate: new Date().toISOString() })
      .expect(403);

    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/glucose-readings"))
      .send({ measuredAt: new Date().toISOString(), context: "random", valueMgDl: 100 })
      .expect(201);
    await auth(tokenB, profileA)(request(app.getHttpServer()).delete(`/v1/glucose-readings/${created.body.id}`)).expect(403);
  });
});
