import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Medical test reports (docs/07 screen 44, docs/13 "medical_reports") — the
 * archive of blood/urine panels, scans, ECGs, biopsies and discharge
 * summaries. Document-first by design: there are no per-analyte values to
 * assert, so these cover the record itself, its document attachment through
 * the shared upload pipeline, and the scope/soft-delete semantics.
 */
describe("Reports e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000891";
  const PHONE_B = "+919000000892";
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
        medical_reports, prescriptions, practitioners, patient_allergies,
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
  let reportId: string;
  let documentId: string;

  it("sets up a patient and a view_medications-only caregiver", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Report Test", yearOfBirth: 1968, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    tokenB = await signIn(PHONE_B);
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: invite.body.id }).expect(201);
  });

  it("creates a report and lists it", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/reports"))
      .send({
        kind: "blood_test",
        label: "Thyroid panel",
        facilityName: "Apollo Diagnostics",
        practitionerName: "Dr. Rao",
        testedAt: "2026-07-25",
        notes: "TSH slightly high, recheck in 3 months",
      })
      .expect(201);
    reportId = created.body.id;
    expect(created.body).toMatchObject({
      kind: "blood_test",
      label: "Thyroid panel",
      facilityName: "Apollo Diagnostics",
      practitionerName: "Dr. Rao",
      testedAt: "2026-07-25",
    });

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/reports")).expect(200);
    expect(list.body.items.find((r: { id: string }) => r.id === reportId)).toMatchObject({
      kind: "blood_test",
      documentCount: 0,
    });
  });

  it("accepts a report with only the kind — a patient who can't read it should still keep the photo", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/reports"))
      .send({ kind: "imaging" })
      .expect(201);
    expect(created.body).toMatchObject({
      kind: "imaging",
      label: null,
      facilityName: null,
      practitionerName: null,
      testedAt: null,
      notes: null,
    });
  });

  it("rejects a report with no kind — that's the one thing the record can't be without", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/reports")).send({}).expect(400);
  });

  it("a doctor named on both a report and a prescription resolves to one practitioner record", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "  dr. rao  " })
      .expect(201);

    const practitioners = await prisma.practitioner.findMany({
      where: { createdByProfileId: profileA, displayName: { equals: "Dr. Rao", mode: "insensitive" } },
    });
    expect(practitioners).toHaveLength(1);
  });

  it("attaches a document to a report through the shared upload pipeline", async () => {
    // A real 1x1 PNG — completeUpload checks the actual magic bytes, so a
    // placeholder string would be quarantined rather than verified.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const authorized = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"))
      .set("idempotency-key", "report-doc-1")
      .send({ kind: "lab_report", reportId, contentType: "image/png", sizeBytes: png.length })
      .expect(201);
    documentId = authorized.body.documentId;

    const uploadPath = authorized.body.uploadUrl.replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer()).put(uploadPath).set("content-type", "image/png").send(png).expect(200);
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/documents/${documentId}/complete`)).expect(201);

    const detail = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/reports/${reportId}`)).expect(200);
    expect(detail.body.documents).toHaveLength(1);
    expect(detail.body.documents[0]).toMatchObject({ id: documentId, kind: "lab_report", downloadable: true });

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/reports")).expect(200);
    expect(list.body.items.find((r: { id: string }) => r.id === reportId).documentCount).toBe(1);
  });

  it("refuses to attach a document to a deleted or unknown report", async () => {
    const deleted = await prisma.medicalReport.create({ data: { patientProfileId: profileA, kind: "other" } });
    await prisma.medicalReport.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

    // A deleted report is as unknown as one that never existed.
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"))
      .set("idempotency-key", "report-doc-deleted")
      .send({ kind: "lab_report", reportId: deleted.id, contentType: "image/png", sizeBytes: 100 })
      .expect(400);

    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"))
      .set("idempotency-key", "report-doc-unknown")
      .send({ kind: "lab_report", reportId: "00000000-0000-4000-8000-000000000000", contentType: "image/png", sizeBytes: 100 })
      .expect(400);
  });

  it("a caregiver with only view_medications can read reports but not create or delete them", async () => {
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/reports")).expect(200);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get(`/v1/reports/${reportId}`)).expect(200);

    await auth(tokenB, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/reports"))
      .send({ kind: "urine_test" })
      .expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).delete(`/v1/reports/${reportId}`)).expect(403);
  });

  it("deleting a report hides it but leaves the uploaded file retrievable", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/reports/${reportId}`)).expect(204);

    await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/reports/${reportId}`)).expect(404);
    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/reports")).expect(200);
    expect(list.body.items.find((r: { id: string }) => r.id === reportId)).toBeUndefined();

    // No cascade anywhere in this app: the document keeps its FK and the
    // original stays downloadable on its own id.
    const row = await prisma.prescriptionDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.reportId).toBe(reportId);
    await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/documents/${documentId}/download-url`)).expect(200);
  });
});
