import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * "My doctors" (Practitioner records): one shared per-profile record behind
 * every prescriber/doctor field. These tests pin the contract that makes
 * that safe: dedup across all three entry points, rename propagating
 * everywhere at once, merge repointing every link before soft-deleting the
 * duplicate, delete refusing while anything still references the record,
 * and profile isolation.
 */
describe("Practitioners e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000971";
  const PHONE_B = "+919000000972";
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
        prescriptions, medical_reports, patient_allergies, patient_conditions,
        consent_events, consents, caregiver_permissions,
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
    return verify.body.token;
  }

  let tokenA: string;
  let tokenB: string;
  let profileA: string;
  let reportId: string;
  let sharmaId: string;
  let variantId: string;

  it("dedups the same doctor named on a medicine, a prescription, and a report into one record", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Practitioners Test", yearOfBirth: 1962, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Doctor Dedup Tablet",
        source: "manual",
        prescriberName: "Dr. Sharma",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);
    // Same doctor, different case and padding — must reuse the row.
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "dr. sharma" })
      .expect(201);
    // A genuinely different spelling — a second record (merge target below).
    const report = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/reports"))
      .send({ kind: "blood_test", practitionerName: "Dr Sharma" })
      .expect(201);
    reportId = report.body.id;

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/practitioners")).expect(200);
    expect(res.body.items).toHaveLength(2);
    const sharma = res.body.items.find((p: { displayName: string }) => p.displayName === "Dr. Sharma");
    const variant = res.body.items.find((p: { displayName: string }) => p.displayName === "Dr Sharma");
    expect(sharma).toMatchObject({ medicationCount: 1, prescriptionCount: 1, reportCount: 0 });
    expect(variant).toMatchObject({ medicationCount: 0, prescriptionCount: 0, reportCount: 1 });
    sharmaId = sharma.id;
    variantId = variant.id;
  });

  it("creating an existing name updates its speciality instead of minting a duplicate", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/practitioners"))
      .send({ displayName: "DR. SHARMA", speciality: "Cardiologist" })
      .expect(201);
    expect(res.body.id).toBe(sharmaId);
    expect(res.body.speciality).toBe("Cardiologist");

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/practitioners")).expect(200);
    expect(list.body.items).toHaveLength(2);
  });

  it("renaming a doctor propagates to the records that name them", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/practitioners/${variantId}`))
      .send({ displayName: "Dr. Kumar" })
      .expect(200);

    const reports = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/reports")).expect(200);
    expect(reports.body.items.find((r: { id: string }) => r.id === reportId).practitionerName).toBe("Dr. Kumar");

    // The other doctor's records are untouched.
    const prescriptions = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/prescriptions")).expect(200);
    expect(prescriptions.body.items[0].practitionerName).toBe("Dr. Sharma");
  });

  it("renaming onto another doctor's name is rejected toward merge", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/practitioners/${variantId}`))
      .send({ displayName: "dr. sharma" })
      .expect(400);
    expect(res.body.code).toBe("validation_failed");
  });

  it("merging repoints every linked record and retires the duplicate", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/practitioners/${variantId}/merge`))
      .send({ targetId: sharmaId })
      .expect(201);
    expect(res.body).toMatchObject({ id: sharmaId, medicationCount: 1, prescriptionCount: 1, reportCount: 1 });

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/practitioners")).expect(200);
    expect(list.body.items).toHaveLength(1);

    const reports = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/reports")).expect(200);
    expect(reports.body.items.find((r: { id: string }) => r.id === reportId).practitionerName).toBe("Dr. Sharma");
  });

  it("deleting is refused while records still reference the doctor, and works once unused", async () => {
    const blocked = await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/practitioners/${sharmaId}`)).expect(400);
    expect(blocked.body.code).toBe("validation_failed");

    const fresh = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/practitioners"))
      .send({ displayName: "Dr. Unused" })
      .expect(201);
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/practitioners/${fresh.body.id}`)).expect(204);

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/practitioners")).expect(200);
    expect(list.body.items.map((p: { displayName: string }) => p.displayName)).toEqual(["Dr. Sharma"]);
  });

  it("another user's profile cannot see or touch these records", async () => {
    tokenB = await signIn(PHONE_B);
    const profileB = await auth(tokenB)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Someone Else", yearOfBirth: 1990, preferredLocale: "en" })
      .expect(201);

    const list = await auth(tokenB, profileB.body.id)(
      request(app.getHttpServer()).get("/v1/profiles/current/practitioners"),
    ).expect(200);
    expect(list.body.items).toHaveLength(0);

    await auth(tokenB, profileB.body.id)(request(app.getHttpServer()).patch(`/v1/practitioners/${sharmaId}`))
      .send({ displayName: "Hijacked" })
      .expect(404);
  });
});
