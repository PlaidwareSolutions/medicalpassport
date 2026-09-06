import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Prescription line items (docs_v2/04 §4.1, docs_v2/05 §4): what the doctor
 * wrote, kept separate from what the patient is actually taking.
 *
 * The distinction is the point. A line can be prescribed and never started,
 * which is a normal outcome rather than an incomplete record, so the two must
 * not be conflated. And a line the patient could only half-read must still be
 * fileable: only the name is required.
 *
 * The hazard these tests guard is H-02, starting a medicine on a dose nobody
 * actually read. A line with no dose is refused rather than guessed, and the
 * patient supplies it through the same pickers as adding a medicine by hand.
 */
describe("Prescription line items e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000991";
  const PHONE_B = "+919000000992";
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
        medication_refill_plans, medication_instructions, prescription_items,
        patient_medications, practitioners, prescriptions, medical_reports,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions, user_devices,
        otp_attempts, patient_profiles, users CASCADE
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

  let tokenA: string;
  let profileA: string;
  let prescriptionId: string;
  let fullLineId: string;
  let bareLineId: string;

  it("files a prescription with the lines as written, including one only half-legible", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Items Test Patient", yearOfBirth: 1959, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({
        practitionerName: "Dr. Venkatasubramanian",
        prescribedAt: "2026-08-01",
        diagnosisText: "Type 2 diabetes, hypertension",
        followUpOn: "2026-09-01",
        items: [
          { enteredName: "Metformin 500", doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", foodInstruction: "after", durationDays: 30 },
          // The patient could read the name and nothing else. Still filed.
          { enteredName: "Telmisartan" },
        ],
      })
      .expect(201);

    prescriptionId = res.body.id;
    expect(res.body.diagnosisText).toBe("Type 2 diabetes, hypertension");
    expect(res.body.followUpOn).toBe("2026-09-01");
    expect(res.body.items).toHaveLength(2);
    // Page order is preserved without the client having to number the lines.
    expect(res.body.items.map((i: { sequence: number }) => i.sequence)).toEqual([1, 2]);
    fullLineId = res.body.items[0].id;
    bareLineId = res.body.items[1].id;
    // Filing a prescription starts nothing on its own.
    expect(res.body.items.every((i: { startedMedicationId: string | null }) => i.startedMedicationId === null)).toBe(true);
    expect(await prisma.patientMedication.count({ where: { patientProfileId: profileA } })).toBe(0);
  });

  it("refuses to start a line whose dose nobody could read", async () => {
    const res = await auth(tokenA, profileA)(
      request(app.getHttpServer()).post(`/v1/prescription-items/${bareLineId}/start-medication`),
    ).send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_failed");
    const paths = (res.body.errors ?? []).map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["doseQuantity", "doseUnit", "frequencyCode"]));
    expect(await prisma.patientMedication.count({ where: { patientProfileId: profileA } })).toBe(0);
  });

  it("starts that line once the patient supplies the dose themselves", async () => {
    const res = await auth(tokenA, profileA)(
      request(app.getHttpServer()).post(`/v1/prescription-items/${bareLineId}/start-medication`),
    )
      .send({ doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", foodInstruction: "after" })
      .expect(201);

    expect(res.body.enteredName).toBe("Telmisartan");
    expect(res.body.instruction.frequencyCode).toBe("OD");
    // The medicine points back at the prescription that produced it.
    expect(res.body.prescription?.id).toBe(prescriptionId);

    const item = await prisma.prescriptionItem.findUniqueOrThrow({ where: { id: bareLineId } });
    expect(item.startedMedicationId).toBe(res.body.id);
  });

  it("carries the line's own dose over when the paper was legible", async () => {
    const res = await auth(tokenA, profileA)(
      request(app.getHttpServer()).post(`/v1/prescription-items/${fullLineId}/start-medication`),
    )
      .send({})
      .expect(201);

    expect(res.body.enteredName).toBe("Metformin 500");
    expect(res.body.instruction.doseQuantity).toBe("1");
    expect(res.body.instruction.frequencyCode).toBe("BD");
    expect(res.body.instruction.foodInstruction).toBe("after");
    expect(res.body.instruction.durationDays).toBe(30);
  });

  it("refuses to start the same line twice", async () => {
    const res = await auth(tokenA, profileA)(
      request(app.getHttpServer()).post(`/v1/prescription-items/${fullLineId}/start-medication`),
    ).send({});
    expect(res.status).toBe(409);
    expect(await prisma.patientMedication.count({ where: { patientProfileId: profileA, deletedAt: null } })).toBe(2);
  });

  it("adds, edits and removes a line after the prescription was filed", async () => {
    const added = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/prescriptions/${prescriptionId}/items`))
      .send({ enteredName: "Atorvastatin 10", frequencyCode: "HS" })
      .expect(201);
    expect(added.body.sequence).toBe(3);

    const edited = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/prescription-items/${added.body.id}`))
      .send({ strengthLabel: "10 mg", instructionsText: "at bedtime" })
      .expect(200);
    expect(edited.body.strengthLabel).toBe("10 mg");
    expect(edited.body.enteredName).toBe("Atorvastatin 10");

    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/prescription-items/${added.body.id}`)).expect(204);

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/prescriptions/${prescriptionId}/items`)).expect(200);
    expect(list.body.items).toHaveLength(2);
    // Soft delete: the row survives for the audit trail.
    const row = await prisma.prescriptionItem.findUniqueOrThrow({ where: { id: added.body.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it("stamps provenance on the lines and never accepts it from the client", async () => {
    const item = await prisma.prescriptionItem.findUniqueOrThrow({ where: { id: fullLineId } });
    expect(item.provenanceSource).toBe("user_entered");
    expect(item.verification).toBe("patient_confirmed");
    expect(item.recordedByUserId).not.toBeNull();

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/prescriptions/${prescriptionId}/items`))
      .send({ enteredName: "Injected", provenanceSource: "lab_imported", verification: "source_authenticated" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("provenance_not_client_settable");
  });

  it("keeps one patient's lines unreachable from another's session", async () => {
    const tokenB = await signIn(PHONE_B);
    const profile = await auth(tokenB)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Someone Else", yearOfBirth: 1975, preferredLocale: "en" })
      .expect(201);

    await auth(tokenB, profile.body.id)(request(app.getHttpServer()).get(`/v1/prescriptions/${prescriptionId}/items`)).expect(404);
    await auth(tokenB, profile.body.id)(request(app.getHttpServer()).patch(`/v1/prescription-items/${fullLineId}`))
      .send({ enteredName: "Tampered" })
      .expect(404);

    const untouched = await prisma.prescriptionItem.findUniqueOrThrow({ where: { id: fullLineId } });
    expect(untouched.enteredName).toBe("Metformin 500");
  });

  it("uses an idempotency key on the medicine it creates, like every other add path", async () => {
    // Guards against a lost response starting the same medicine twice.
    const before = await prisma.patientMedication.count({ where: { patientProfileId: profileA, deletedAt: null } });
    const added = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/prescriptions/${prescriptionId}/items`))
      .send({ enteredName: "Pantoprazole 40", doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" })
      .expect(201);
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/prescription-items/${added.body.id}/start-medication`))
      .set("idempotency-key", randomUUID())
      .send({})
      .expect(201);
    expect(await prisma.patientMedication.count({ where: { patientProfileId: profileA, deletedAt: null } })).toBe(before + 1);
  });
});
