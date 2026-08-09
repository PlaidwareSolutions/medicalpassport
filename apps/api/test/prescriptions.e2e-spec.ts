import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Prescription records (docs/07 screen 43, docs/13 "prescriptions") — the
 * standing archive of what each doctor prescribed, with medications
 * optionally linked to one as evidence. Also covers the practitioner-dedup
 * fix and the clear-the-prescriber bug fix this feature required.
 */
describe("Prescriptions e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000881";
  const PHONE_B = "+919000000882";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, extraction_candidates,
        prescription_extractions, prescription_documents, object_access_events,
        stored_objects, dose_events, scheduled_doses, medication_schedules,
        medication_changes, medication_instructions, patient_medications,
        prescriptions, practitioners, patient_allergies, patient_conditions,
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
  let prescriptionId: string;
  let medicationId: string;

  it("sets up a patient and a view_medications-only caregiver", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Prescription Test", yearOfBirth: 1972, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    tokenB = await signIn(PHONE_B);
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: invite.body.id }).expect(201);
  });

  it("creates a prescription and lists it with its counts", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "Dr. Sharma", prescribedAt: "2026-07-20", notes: "Follow up in a month" })
      .expect(201);
    prescriptionId = created.body.id;
    expect(created.body).toMatchObject({ practitionerName: "Dr. Sharma", prescribedAt: "2026-07-20" });

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/prescriptions")).expect(200);
    expect(list.body.items.find((p: { id: string }) => p.id === prescriptionId)).toMatchObject({
      practitionerName: "Dr. Sharma",
      documentCount: 0,
      medicationCount: 0,
    });
  });

  it("accepts a prescription with nothing filled in — an unreadable one is still worth filing", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({})
      .expect(201);
    expect(created.body).toMatchObject({ practitionerName: null, prescribedAt: null, notes: null });
  });

  it("a medicine created against a prescription inherits its doctor without re-typing", async () => {
    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Prescribed Tablet",
        source: "manual",
        prescriptionId,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);
    medicationId = med.body.id;
    expect(med.body.prescriberName).toBe("Dr. Sharma");
    expect(med.body.prescription).toMatchObject({ id: prescriptionId, practitionerName: "Dr. Sharma" });

    const detail = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/prescriptions/${prescriptionId}`)).expect(200);
    expect(detail.body.medications.map((m: { id: string }) => m.id)).toContain(medicationId);
  });

  it("two medicines naming the same doctor share one practitioner record", async () => {
    const first = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Dedup Tablet One",
        source: "manual",
        prescriberName: "Dr. Mehta",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);
    // Different capitalisation/spacing is the same human being.
    const second = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Dedup Tablet Two",
        source: "manual",
        prescriberName: "  dr. mehta  ",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);

    expect(first.body.prescriberName).toBe("Dr. Mehta");
    expect(second.body.prescriberName).toBe("Dr. Mehta");
    const practitioners = await prisma.practitioner.findMany({
      where: { createdByProfileId: profileA, displayName: { equals: "Dr. Mehta", mode: "insensitive" } },
    });
    expect(practitioners).toHaveLength(1);
  });

  it("clearing the prescriber unlinks it instead of creating an unnamed record", async () => {
    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Clear Prescriber Tablet",
        source: "manual",
        prescriberName: "Dr. Temporary",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);

    const updated = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${med.body.id}`))
      .send({ rowVersion: med.body.rowVersion, prescriberName: "" })
      .expect(200);
    expect(updated.body.prescriberName).toBeNull();

    const unnamed = await prisma.practitioner.findMany({ where: { createdByProfileId: profileA, displayName: "" } });
    expect(unnamed).toHaveLength(0);
  });

  it("links an already-added medicine to a prescription", async () => {
    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Later Linked Tablet",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);

    const detail = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/prescriptions/${prescriptionId}/medications`))
      .send({ medicationId: med.body.id })
      .expect(201);
    expect(detail.body.medications.map((m: { id: string }) => m.id)).toContain(med.body.id);

    // Had no prescriber of its own, so the prescription's doctor carries over.
    const fresh = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${med.body.id}`)).expect(200);
    expect(fresh.body.prescriberName).toBe("Dr. Sharma");
  });

  it("a caregiver with only view_medications can read prescriptions but not create or delete them", async () => {
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/prescriptions")).expect(200);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get(`/v1/prescriptions/${prescriptionId}`)).expect(200);

    await auth(tokenB, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "Dr. Nope" })
      .expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).delete(`/v1/prescriptions/${prescriptionId}`)).expect(403);
  });

  it("a failed upload's deleted stub doesn't count as a file in list or detail", async () => {
    // The broken-CORS era pattern: authorize-upload creates the document
    // row, the browser PUT dies, and cleanup-abandoned-uploads later marks
    // the never-completed stub deleted. The record must then honestly show
    // zero files, not advertise a dead one.
    const rx = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "Dr. Stub" })
      .expect(201);
    const upload = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"))
      .send({ kind: "prescription", prescriptionId: rx.body.id, contentType: "image/png", sizeBytes: 1234 })
      .expect(201);
    await prisma.prescriptionDocument.update({ where: { id: upload.body.documentId }, data: { status: "deleted" } });

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/prescriptions")).expect(200);
    expect(list.body.items.find((p: { id: string }) => p.id === rx.body.id).documentCount).toBe(0);
    const detail = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/prescriptions/${rx.body.id}`)).expect(200);
    expect(detail.body.documents).toHaveLength(0);
  });

  it("deleting a prescription hides it but leaves its linked medicine intact", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/prescriptions/${prescriptionId}`)).expect(204);

    await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/prescriptions/${prescriptionId}`)).expect(404);
    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/prescriptions")).expect(200);
    expect(list.body.items.find((p: { id: string }) => p.id === prescriptionId)).toBeUndefined();

    // The medicine itself survives untouched — this app never cascades a
    // soft-delete into child rows — it just stops advertising stale evidence.
    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(med.body.prescription).toBeNull();
    expect(med.body.prescriberName).toBe("Dr. Sharma");
    const row = await prisma.patientMedication.findUniqueOrThrow({ where: { id: medicationId } });
    expect(row.prescriptionId).toBe(prescriptionId);
  });
});
