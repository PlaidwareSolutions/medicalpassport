import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { stepUp } from "./helpers/step-up";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * The family dashboard (docs_v2/05 §8, docs_v2/06 P6-3): one call, every
 * profile the caller can act on, a per-profile summary whose fields are
 * null — not absent, not zero — when the caller's scopes do not grant
 * them. `nextTestDue` is a placeholder until TestDueSchedule ships.
 */
describe("Family dashboard e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000911"; // patient
  const PHONE_B = "+919000000912"; // caregiver: view_medications only
  const PHONE_C = "+919000000913"; // caregiver: full_management
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, observations,
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
  let tokenC: string;
  let profileA: string;
  let dependentId: string;
  let profileB: string;

  type Row = {
    id: string;
    displayName: string;
    relationship: string;
    scopes: string[];
    summary: { dueDosesToday: number | null; openAlerts: number | null; lastMeasurement: { concept: string; value: string; value2: string | null; unit: string } | null; nextTestDue: null };
  };
  const family = async (token: string): Promise<Row[]> => (await auth(token)(request(app.getHttpServer()).get("/v1/profiles/current/family")).expect(200)).body.items;

  it("sets up a patient with a dependent, a scheduled medicine, a missed dose and a measurement, plus two caregivers", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Family Patient", yearOfBirth: 1950, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;
    const dependent = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Family Parent", yearOfBirth: 1930, relationship: "parent", preferredLocale: "en" })
      .expect(201);
    dependentId = dependent.body.id;

    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({ enteredName: "Family Test Tablet", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" } })
      .expect(201);
    const schedule = await prisma.medicationSchedule.findFirstOrThrow({ where: { patientMedicationId: med.body.id } });
    const dose = await prisma.scheduledDose.findFirstOrThrow({ where: { medicationScheduleId: schedule.id }, orderBy: { dueAt: "asc" } });
    await prisma.scheduledDose.update({ where: { id: dose.id }, data: { status: "missed", dueAt: new Date(Date.now() - 3 * 60 * 60_000) } });

    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/observations"))
      .send({ concept: "body_weight", valueNumeric: 72.4, measuredAt: new Date().toISOString() })
      .expect(201);

    tokenB = await signIn(PHONE_B);
    const own = await auth(tokenB)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Caregiver B Self", yearOfBirth: 1980, preferredLocale: "en" })
      .expect(201);
    profileB = own.body.id;
    await stepUp(app.getHttpServer(), tokenA);
    const inviteB = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: inviteB.body.id }).expect(201);

    tokenC = await signIn(PHONE_C);
    const inviteC = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_C, scopes: ["full_management"], relationship: "spouse" })
      .expect(201);
    await auth(tokenC)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: inviteC.body.id }).expect(201);
  });

  it("the patient sees self and dependent with every summary field, no scopes, and the placeholder nextTestDue", async () => {
    const rows = await family(tokenA);
    expect(rows.map((r) => r.relationship).sort()).toEqual(["dependent", "self"]);
    const self = rows.find((r) => r.id === profileA)!;
    expect(self.displayName).toBe("Family Patient");
    expect(self.scopes).toEqual([]);
    expect(typeof self.summary.dueDosesToday).toBe("number");
    expect(self.summary.openAlerts).toBe(1);
    expect(self.summary.lastMeasurement).toMatchObject({ concept: "body_weight", value: "72.4", value2: null, unit: "kg" });
    expect(self.summary.nextTestDue).toBeNull();

    const dependent = rows.find((r) => r.id === dependentId)!;
    expect(dependent.summary).toEqual({ dueDosesToday: 0, openAlerts: 0, lastMeasurement: null, nextTestDue: null });
  });

  it("a view-only caregiver sees the profile, their scopes, and null for what those scopes do not grant", async () => {
    const rows = await family(tokenB);
    expect(rows.map((r) => r.relationship).sort()).toEqual(["caregiver", "self"]);
    expect(rows.find((r) => r.id === profileB)!.relationship).toBe("self");

    const patient = rows.find((r) => r.id === profileA)!;
    expect(patient.scopes).toEqual(["view_medications"]);
    // view_medications grants view_measurements (additive V2 split) but not
    // view_schedule or manage_reminders — so doses and alerts are "not yours".
    expect(patient.summary.dueDosesToday).toBeNull();
    expect(patient.summary.openAlerts).toBeNull();
    expect(patient.summary.lastMeasurement).toMatchObject({ concept: "body_weight" });
    // And the dependent, which B has no relationship with, is not listed at all.
    expect(rows.find((r) => r.id === dependentId)).toBeUndefined();
  });

  it("a full_management caregiver sees every summary field", async () => {
    const rows = await family(tokenC);
    const patient = rows.find((r) => r.id === profileA)!;
    expect(patient.relationship).toBe("caregiver");
    expect(patient.scopes).toEqual(["full_management"]);
    expect(typeof patient.summary.dueDosesToday).toBe("number");
    expect(patient.summary.openAlerts).toBe(1);
    expect(patient.summary.lastMeasurement).toMatchObject({ concept: "body_weight" });
  });

  it("every caregiver-side read of the dashboard is audited against the relationship, the patient's own is not", async () => {
    const audits = await prisma.auditEvent.findMany({ where: { patientProfileId: profileA, action: "caregiver.family_viewed" } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.every((a) => a.actorType === "caregiver" && a.entityType === "caregiver_relationship")).toBe(true);
    const ownerId = (await prisma.patientProfile.findUniqueOrThrow({ where: { id: profileA } })).ownerUserId;
    expect(audits.some((a) => a.actorUserId === ownerId)).toBe(false);
  });

  it("resolving the missed dose clears the alert count for everyone who could see it", async () => {
    const dose = await prisma.scheduledDose.findFirstOrThrow({ where: { status: "missed", medicationSchedule: { patientMedication: { patientProfileId: profileA } } } });
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/doses/${dose.id}/events`))
      .send({ action: "taken_other_time", effectiveAt: new Date().toISOString() })
      .expect(201);
    expect((await family(tokenA)).find((r) => r.id === profileA)!.summary.openAlerts).toBe(0);
    expect((await family(tokenC)).find((r) => r.id === profileA)!.summary.openAlerts).toBe(0);
  });

  it("a revoked caregiver no longer sees the profile at all", async () => {
    const relationship = await prisma.caregiverRelationship.findFirstOrThrow({ where: { patientProfileId: profileA, relationship: "child" } });
    await stepUp(app.getHttpServer(), tokenA);
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/caregivers/${relationship.id}`)).expect(204);
    const rows = await family(tokenB);
    expect(rows.map((r) => r.id)).toEqual([profileB]);
  });

  it("requires a session", async () => {
    await request(app.getHttpServer()).get("/v1/profiles/current/family").expect(401);
  });
});
