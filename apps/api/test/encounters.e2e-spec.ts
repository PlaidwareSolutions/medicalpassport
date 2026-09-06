import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Encounters (docs_v2/04 §3.3, WP P1-2): CRUD with provenance + audit +
 * timeline projection, linking a prescription and a report to a visit, and
 * the IDOR guard — another patient's encounter is a 404, never a 403 that
 * would confirm it exists.
 */
describe("Encounters e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000901";
  const PHONE_B = "+919000000902";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, encounters, organizations,
        prescription_documents, object_access_events, stored_objects,
        report_values, medical_reports, dose_events, scheduled_doses, medication_schedules,
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
  let profileB: string;
  let encounterId: string;
  let prescriptionId: string;
  let reportId: string;

  it("sets up two unrelated patients", async () => {
    tokenA = await signIn(PHONE_A);
    profileA = (
      await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
        .send({ displayName: "Encounter Patient", yearOfBirth: 1970, preferredLocale: "en" })
        .expect(201)
    ).body.id;
    tokenB = await signIn(PHONE_B);
    profileB = (
      await auth(tokenB)(request(app.getHttpServer()).post("/v1/profiles"))
        .send({ displayName: "Other Patient", yearOfBirth: 1980, preferredLocale: "en" })
        .expect(201)
    ).body.id;
  });

  it("creates an outpatient visit with server-stamped provenance, an audit row and a doctor_visit event", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/encounters"))
      .set("x-client", "native_android")
      .send({ kind: "outpatient", startedAt: "2026-08-01T04:30:00.000Z", reasonText: "Fever for three days" })
      .expect(201);
    encounterId = res.body.id;
    expect(res.body).toMatchObject({
      kind: "outpatient",
      startedAt: "2026-08-01T04:30:00.000Z",
      endedAt: null,
      reasonText: "Fever for three days",
      organizationName: null,
      practitionerName: null,
      provenanceSource: "user_entered",
      verification: "patient_confirmed",
      rowVersion: 0,
      prescriptions: [],
      medicalReports: [],
      conditions: [],
      procedures: [],
    });

    const row = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(row).toMatchObject({ provenanceSource: "user_entered", verification: "patient_confirmed", recordedVia: "native_android" });
    expect(await prisma.auditEvent.count({ where: { action: "encounter.created", entityId: encounterId } })).toBe(1);

    const events = await prisma.healthEvent.findMany({ where: { entityType: "encounter", entityId: encounterId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "doctor_visit",
      encounterId,
      occurredAtLocal: "2026-08-01T10:00:00", // Asia/Kolkata (profile default)
      provenanceSource: "user_entered",
      verification: "patient_confirmed",
      supersededAt: null,
    });
  });

  it("rejects a client-supplied provenance field, an unknown x-client, and an end before the start", async () => {
    const forged = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/encounters"))
      .send({ kind: "outpatient", startedAt: "2026-08-02T04:30:00.000Z", verification: "provider_verified" })
      .expect(400);
    expect(forged.body.code).toBe("provenance_not_client_settable");
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/encounters"))
      .send({ kind: "outpatient", startedAt: "2026-08-02T04:30:00.000Z", endedAt: "2026-08-01T04:30:00.000Z" })
      .expect(400);
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/encounters"))
      .set("x-client", "curl")
      .send({ kind: "outpatient", startedAt: "2026-08-02T04:30:00.000Z" })
      .expect(400);
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/encounters"))
      .send({ kind: "outpatient", startedAt: "2026-08-02T04:30:00.000Z", organizationId: "00000000-0000-4000-8000-000000000000" })
      .expect(400);
  });

  it("lists the visit newest first", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/encounters"))
      .send({ kind: "teleconsult", startedAt: "2026-07-01T04:30:00.000Z" })
      .expect(201);
    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/encounters")).expect(200);
    expect(list.body.items.map((e: { id: string }) => e.id)[0]).toBe(encounterId);
    expect(list.body.items).toHaveLength(2);
  });

  it("links a prescription and a report to the visit, and the detail shows both", async () => {
    const rx = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "Dr. Rao", prescribedAt: "2026-08-01", encounterId })
      .expect(201);
    prescriptionId = rx.body.id;
    expect(rx.body.encounterId).toBe(encounterId);

    const report = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/reports"))
      .send({ kind: "blood_test", label: "CBC", testedAt: "2026-08-01", encounterId })
      .expect(201);
    reportId = report.body.id;
    expect(report.body.encounterId).toBe(encounterId);

    const detail = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/encounters/${encounterId}`)).expect(200);
    expect(detail.body.prescriptions).toEqual([{ id: prescriptionId, prescribedAt: "2026-08-01", practitionerName: "Dr. Rao" }]);
    expect(detail.body.medicalReports).toEqual([{ id: reportId, kind: "blood_test", label: "CBC", testedAt: "2026-08-01" }]);

    // The linked rows' own timeline events carry the encounter.
    const rxEvent = await prisma.healthEvent.findFirstOrThrow({ where: { entityType: "prescription", entityId: prescriptionId } });
    expect(rxEvent.encounterId).toBe(encounterId);
    const reportEvent = await prisma.healthEvent.findFirstOrThrow({ where: { entityType: "medical_report", entityId: reportId } });
    expect(reportEvent.encounterId).toBe(encounterId);
  });

  it("refuses to link a prescription or report to another profile's encounter", async () => {
    await auth(tokenB, profileB)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "Dr. Rao", encounterId })
      .expect(400);
    await auth(tokenB, profileB)(request(app.getHttpServer()).post("/v1/profiles/current/reports"))
      .send({ kind: "blood_test", encounterId })
      .expect(400);
    expect(await prisma.prescription.count({ where: { encounterId } })).toBe(1);
  });

  it("updates the visit, supersedes the old event and re-projects (inpatient → admission + discharge)", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/encounters/${encounterId}`))
      .send({ kind: "inpatient", endedAt: "2026-08-03T04:30:00.000Z", diagnosisText: "Dengue", rowVersion: 0 })
      .expect(200);
    expect(res.body).toMatchObject({ kind: "inpatient", endedAt: "2026-08-03T04:30:00.000Z", diagnosisText: "Dengue", rowVersion: 1 });

    const events = await prisma.healthEvent.findMany({ where: { entityType: "encounter", entityId: encounterId }, orderBy: { occurredAt: "asc" } });
    const live = events.filter((e) => e.supersededAt === null).map((e) => e.kind);
    expect(live).toEqual(["hospital_admission", "discharge"]);
    expect(events.find((e) => e.kind === "doctor_visit")!.supersededAt).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "encounter.updated", entityId: encounterId } })).toBe(1);

    // A stale rowVersion is a 409, not a silent overwrite.
    await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/encounters/${encounterId}`))
      .send({ reasonText: "changed elsewhere", rowVersion: 0 })
      .expect(409);
  });

  it("IDOR: another patient cannot read, update or delete the visit", async () => {
    await auth(tokenB, profileB)(request(app.getHttpServer()).get(`/v1/encounters/${encounterId}`)).expect(404);
    await auth(tokenB, profileB)(request(app.getHttpServer()).patch(`/v1/encounters/${encounterId}`)).send({ notes: "x" }).expect(404);
    await auth(tokenB, profileB)(request(app.getHttpServer()).delete(`/v1/encounters/${encounterId}`)).expect(404);
    // B's own list is empty — A's visits never leak across the profile header.
    const list = await auth(tokenB, profileB)(request(app.getHttpServer()).get("/v1/profiles/current/encounters")).expect(200);
    expect(list.body.items).toEqual([]);
    // A using B's profile id is refused outright.
    await auth(tokenA, profileB)(request(app.getHttpServer()).get(`/v1/encounters/${encounterId}`)).expect(403);
  });

  it("soft-deletes the visit: gone from reads, events superseded, linked records untouched", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/encounters/${encounterId}`)).expect(204);
    await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/encounters/${encounterId}`)).expect(404);
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/encounters/${encounterId}`)).expect(404);

    const row = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    expect(row.deletedAt).not.toBeNull();
    const live = await prisma.healthEvent.count({ where: { entityType: "encounter", entityId: encounterId, supersededAt: null } });
    expect(live).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "encounter.deleted", entityId: encounterId } })).toBe(1);

    // The prescription still exists and still points at the visit (no cascade).
    const rx = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/prescriptions/${prescriptionId}`)).expect(200);
    expect(rx.body.encounterId).toBe(encounterId);
  });
});
