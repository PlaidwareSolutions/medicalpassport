import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";

/**
 * Provider directory administration (provider_admin duty, P1-6): duty
 * enforcement, global organization create/list/update/verify/merge,
 * practitioner verify — and, above all, the PHI boundary: a patient-entered
 * facility or doctor reaches an admin session as an opaque id + counts, never
 * as a name, address, phone or profile id.
 */
describe("Admin organizations e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000882";
  const PATIENT_NAME = "Org Fixture Patient Name";
  const PATIENT_CLINIC = "Secret Patient Clinic";
  const PATIENT_CLINIC_PHONE = "+919000000777";
  const PATIENT_DOCTOR = "Dr Secret Patient Doctor";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  let providerAdmin: string[];
  let usersOnly: string[];
  let noDuty: string[];
  let superAdmin: string[];
  let profileId: string;
  let patientOrgId: string;
  let patientPractitionerId: string;
  let orgA: string;
  let orgB: string;
  let globalPractitionerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, admin_sessions, admin_users,
        encounters, immunizations, procedures, organizations, practitioners,
        patient_medications, medication_instructions, medication_changes,
        consent_events, consents, caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    providerAdmin = await createAdminWithSession("providers@test.com", ["provider_admin"]);
    usersOnly = await createAdminWithSession("users-only@test.com", ["users_view"]);
    noDuty = await createAdminWithSession("no-duty@test.com", []);
    superAdmin = await createAdminWithSession("super@test.com", ["super_admin"]);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAdminWithSession(email: string, duties: string[]): Promise<string[]> {
    const admin = await prisma.adminUser.create({ data: { email, passwordHash: hashPassword("test-password-123"), duties: duties as never } });
    const token = newOpaqueToken();
    await prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashSessionToken(token),
        refreshTokenHash: hashSessionToken(newOpaqueToken()),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return [`medpass_admin_session=${token}`];
  }

  const admin = (cookies: string[]) => ({
    get: (path: string) => request(app.getHttpServer()).get(path).set("Cookie", cookies),
    post: (path: string) => request(app.getHttpServer()).post(path).set("Cookie", cookies).set("x-requested-with", "medpass"),
    patch: (path: string) => request(app.getHttpServer()).patch(path).set("Cookie", cookies).set("x-requested-with", "medpass"),
  });

  /** The strings that must never appear in any admin response body. */
  function expectPhiFree(body: unknown) {
    const text = JSON.stringify(body);
    expect(text).not.toContain(PATIENT_NAME);
    expect(text).not.toContain(PATIENT_CLINIC);
    expect(text).not.toContain(PATIENT_DOCTOR);
    expect(text).not.toContain("9000000777");
    expect(text).not.toContain(profileId);
  }

  it("fixture: a patient adds their own clinic (with phone) and doctor", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    const token = verify.body.token;
    const patient = (method: "post", path: string) =>
      request(app.getHttpServer())
        [method](path)
        .set("authorization", `Bearer ${token}`)
        .set("x-requested-with", "medpass")
        .set("idempotency-key", crypto.randomUUID());

    const profile = await patient("post", "/v1/profiles").send({ displayName: PATIENT_NAME, yearOfBirth: 1970, preferredLocale: "en" }).expect(201);
    profileId = profile.body.id;

    const org = await patient("post", "/v1/profiles/current/organizations")
      .set("x-profile-id", profileId)
      .send({ kind: "clinic", displayName: PATIENT_CLINIC, city: "Hyderabad", phone: PATIENT_CLINIC_PHONE })
      .expect(201);
    patientOrgId = org.body.id;

    const doc = await patient("post", "/v1/profiles/current/practitioners")
      .set("x-profile-id", profileId)
      .send({ displayName: PATIENT_DOCTOR, speciality: "Cardiology", organizationId: patientOrgId })
      .expect(201);
    patientPractitionerId = doc.body.id;

    globalPractitionerId = (await prisma.practitioner.create({ data: { displayName: "Dr Global Directory", speciality: "General" } })).id;
  });

  it("duty enforcement: users_view-only and duty-less admins get 403 on every route; super_admin passes", async () => {
    for (const cookies of [usersOnly, noDuty]) {
      await admin(cookies).get("/v1/admin/organizations").expect(403);
      await admin(cookies).get("/v1/admin/practitioners").expect(403);
      await admin(cookies).post("/v1/admin/organizations").send({ kind: "clinic", displayName: "Nope" }).expect(403);
      await admin(cookies).post(`/v1/admin/practitioners/${globalPractitionerId}/verify`).send({ hprId: "HPR-NOPE" }).expect(403);
    }
    expect((await prisma.organization.count({ where: { displayName: "Nope" } }))).toBe(0);
    await admin(superAdmin).get("/v1/admin/organizations").expect(200);
    await request(app.getHttpServer()).get("/v1/admin/organizations").expect(401);
  });

  it("creates global directory entries (unverified, no patient scope) and audits them as admin", async () => {
    const a = await admin(providerAdmin)
      .post("/v1/admin/organizations")
      .send({ kind: "hospital", displayName: "Apollo Hospitals Jubilee Hills", addressText: "Road No 72", city: "Hyderabad", state: "Telangana", pincode: "500033" })
      .expect(201);
    expect(a.body).toMatchObject({ patientScoped: false, kind: "hospital", displayName: "Apollo Hospitals Jubilee Hills", verification: "unverified", hfrId: null, practitionerCount: 0, encounterCount: 0 });
    orgA = a.body.id;
    const b = await admin(providerAdmin).post("/v1/admin/organizations").send({ kind: "hospital", displayName: "Apollo Hospital, Jubilee Hills (dup)" }).expect(201);
    orgB = b.body.id;

    await admin(providerAdmin).post("/v1/admin/organizations").send({ kind: "clinic", displayName: "", pincode: "12" }).expect(400);

    const row = await prisma.organization.findUniqueOrThrow({ where: { id: orgA } });
    expect(row.patientProfileId).toBeNull();
    const audit = await prisma.auditEvent.findFirst({ where: { action: "organization.created", entityId: orgA } });
    expect(audit?.actorType).toBe("admin");
  });

  it("lists: global scope shows full rows; patient scope shows opaque ids + counts only; search never matches patient names", async () => {
    const global = await admin(providerAdmin).get("/v1/admin/organizations?scope=global").expect(200);
    expect(global.body.totals).toEqual({ global: 2, patient: 1 });
    expect(global.body.items.map((i: { id: string }) => i.id).sort()).toEqual([orgA, orgB].sort());
    expect(global.body.items.every((i: { patientScoped: boolean }) => i.patientScoped === false)).toBe(true);
    expectPhiFree(global.body);

    const patient = await admin(providerAdmin).get("/v1/admin/organizations?scope=patient").expect(200);
    expect(patient.body.items).toHaveLength(1);
    const p = patient.body.items[0];
    expect(p).toEqual({
      id: patientOrgId,
      patientScoped: true,
      kind: "clinic",
      verification: "patient_confirmed",
      hfrId: null,
      practitionerCount: 1,
      encounterCount: 0,
      createdAt: expect.any(String),
    });
    expect(Object.keys(p)).not.toEqual(expect.arrayContaining(["displayName", "addressText", "city", "phone", "phoneCiphertext", "patientProfileId"]));
    expectPhiFree(patient.body);

    const all = await admin(providerAdmin).get("/v1/admin/organizations?scope=all").expect(200);
    expect(all.body.items).toHaveLength(3);
    expectPhiFree(all.body);

    // Searching for the patient's facility name finds nothing — not even the opaque row.
    const search = await admin(providerAdmin).get(`/v1/admin/organizations?scope=all&q=${encodeURIComponent("Secret Patient")}`).expect(200);
    expect(search.body.items).toHaveLength(0);
    const found = await admin(providerAdmin).get("/v1/admin/organizations?scope=all&q=apollo&kind=hospital").expect(200);
    expect(found.body.items).toHaveLength(2);

    // Cursor pagination walks every row exactly once.
    const first = await admin(providerAdmin).get("/v1/admin/organizations?scope=all&limit=2").expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await admin(providerAdmin).get(`/v1/admin/organizations?scope=all&limit=2&cursor=${first.body.nextCursor}`).expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    const seen = [...first.body.items, ...second.body.items].map((i: { id: string }) => i.id);
    expect(new Set(seen).size).toBe(3);
  });

  it("updates global entries only — a patient-scoped row is 403 for edit", async () => {
    const res = await admin(providerAdmin).patch(`/v1/admin/organizations/${orgA}`).send({ city: "Hyderabad", pincode: "500033", kind: "hospital" }).expect(200);
    expect(res.body.city).toBe("Hyderabad");
    await admin(providerAdmin).patch(`/v1/admin/organizations/${orgA}`).send({}).expect(400);
    const denied = await admin(providerAdmin).patch(`/v1/admin/organizations/${patientOrgId}`).send({ city: "Leak" }).expect(403);
    expectPhiFree(denied.body);
    await admin(providerAdmin).patch(`/v1/admin/organizations/${crypto.randomUUID()}`).send({ city: "X" }).expect(404);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: patientOrgId } })).city).toBe("Hyderabad");
  });

  it("verifies with an HFR id: provider_verified + audit organization.verified; duplicate HFR ids are refused", async () => {
    const res = await admin(providerAdmin).post(`/v1/admin/organizations/${orgA}/verify`).send({ hfrId: "IN0410000123" }).expect(201);
    expect(res.body).toMatchObject({ id: orgA, hfrId: "IN0410000123", verification: "provider_verified" });
    const audit = await prisma.auditEvent.findFirst({ where: { action: "organization.verified", entityId: orgA } });
    expect(audit).toMatchObject({ actorType: "admin", patientProfileId: null });

    await admin(providerAdmin).post(`/v1/admin/organizations/${orgB}/verify`).send({ hfrId: "IN0410000123" }).expect(409);
    await admin(providerAdmin).post(`/v1/admin/organizations/${orgB}/verify`).send({ hfrId: "bad id!" }).expect(400);

    // A patient-entered facility can be verified too; the response stays opaque and the audit row names the patient profile.
    const p = await admin(providerAdmin).post(`/v1/admin/organizations/${patientOrgId}/verify`).send({ hfrId: "IN0410000999" }).expect(201);
    expect(p.body).toMatchObject({ id: patientOrgId, patientScoped: true, hfrId: "IN0410000999", verification: "provider_verified" });
    expectPhiFree(p.body);
    const pAudit = await prisma.auditEvent.findFirst({ where: { action: "organization.verified", entityId: patientOrgId } });
    expect(pAudit?.patientProfileId).toBe(profileId);
  });

  it("merges global rows: links repoint, the duplicate is retired with mergedIntoId; patient rows and self-merges are refused", async () => {
    await prisma.practitioner.update({ where: { id: globalPractitionerId }, data: { organizationId: orgB } });

    await admin(providerAdmin).post(`/v1/admin/organizations/${orgB}/merge`).send({ intoId: orgB }).expect(400);
    await admin(providerAdmin).post(`/v1/admin/organizations/${patientOrgId}/merge`).send({ intoId: orgA }).expect(403);
    await admin(providerAdmin).post(`/v1/admin/organizations/${orgA}/merge`).send({ intoId: patientOrgId }).expect(403);

    const res = await admin(providerAdmin).post(`/v1/admin/organizations/${orgB}/merge`).send({ intoId: orgA }).expect(201);
    expect(res.body).toMatchObject({ id: orgA, practitionerCount: 1 });

    const retired = await prisma.organization.findUniqueOrThrow({ where: { id: orgB } });
    expect(retired.mergedIntoId).toBe(orgA);
    expect(retired.deletedAt).not.toBeNull();
    expect((await prisma.practitioner.findUniqueOrThrow({ where: { id: globalPractitionerId } })).organizationId).toBe(orgA);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "organization.merged", entityId: orgB } });
    expect(audit?.actorType).toBe("admin");
    expect((audit?.context as { intoId: string; practitioners: number }).intoId).toBe(orgA);

    const list = await admin(providerAdmin).get("/v1/admin/organizations?scope=global").expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([orgA]);
    await admin(providerAdmin).patch(`/v1/admin/organizations/${orgB}`).send({ city: "Gone" }).expect(404);
  });

  it("practitioners: global rows are named, patient rows are opaque ids + counts; search never matches patient names", async () => {
    const all = await admin(providerAdmin).get("/v1/admin/practitioners?scope=all").expect(200);
    expect(all.body.totals).toEqual({ global: 1, patient: 1 });
    expectPhiFree(all.body);

    const global = all.body.items.find((i: { id: string }) => i.id === globalPractitionerId);
    expect(global).toMatchObject({ patientScoped: false, displayName: "Dr Global Directory", organizationId: orgA, verification: "unverified" });

    const patient = all.body.items.find((i: { id: string }) => i.id === patientPractitionerId);
    // (Patient-created practitioners are stored `unverified` today; only the admin HPR path lifts them.)
    expect(patient.verification).not.toBe("provider_verified");
    expect(patient).toEqual({
      id: patientPractitionerId,
      patientScoped: true,
      verification: expect.any(String),
      hprId: null,
      medicationCount: 0,
      prescriptionCount: 0,
      reportCount: 0,
      encounterCount: 0,
      createdAt: expect.any(String),
    });

    const search = await admin(providerAdmin).get(`/v1/admin/practitioners?q=${encodeURIComponent("Secret Patient")}`).expect(200);
    expect(search.body.items).toHaveLength(0);
    const found = await admin(providerAdmin).get("/v1/admin/practitioners?q=global").expect(200);
    expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([globalPractitionerId]);
  });

  it("verifies a practitioner with an HPR id (+ registration): provider_verified, audited, still PHI-free for patient rows", async () => {
    const g = await admin(providerAdmin)
      .post(`/v1/admin/practitioners/${globalPractitionerId}/verify`)
      .send({ hprId: "71-1234-5678-9012", registrationNumber: "TSMC/12345", registrationCouncil: "Telangana State Medical Council" })
      .expect(201);
    expect(g.body).toMatchObject({ id: globalPractitionerId, hprId: "71-1234-5678-9012", registrationNumber: "TSMC/12345", verification: "provider_verified" });

    await admin(providerAdmin).post(`/v1/admin/practitioners/${patientPractitionerId}/verify`).send({ hprId: "71-1234-5678-9012" }).expect(409);
    await admin(providerAdmin).post(`/v1/admin/practitioners/${crypto.randomUUID()}/verify`).send({ hprId: "71-0000-0000-0000" }).expect(404);

    const p = await admin(providerAdmin).post(`/v1/admin/practitioners/${patientPractitionerId}/verify`).send({ hprId: "71-9999-0000-1111" }).expect(201);
    expect(p.body).toMatchObject({ id: patientPractitionerId, patientScoped: true, hprId: "71-9999-0000-1111", verification: "provider_verified" });
    expect(p.body.displayName).toBeUndefined();
    expectPhiFree(p.body);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "practitioner.verified", entityId: patientPractitionerId } });
    expect(audit).toMatchObject({ actorType: "admin", patientProfileId: profileId });

    // The patient still sees their own doctor by name — verification did not disturb the record.
    const row = await prisma.practitioner.findUniqueOrThrow({ where: { id: patientPractitionerId } });
    expect(row.displayName).toBe(PATIENT_DOCTOR);
    expect(row.createdByProfileId).toBe(profileId);
  });

  it("no admin response body across the whole run carried patient PHI (audit context is PHI-free too)", async () => {
    const events = await prisma.auditEvent.findMany({ where: { actorType: "admin" } });
    expect(events.length).toBeGreaterThanOrEqual(6);
    for (const e of events) expectPhiFree(e.context);
  });
});
