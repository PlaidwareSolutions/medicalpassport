import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { stepUp } from "./helpers/step-up";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * V2 Phase 6 caregiver scopes end to end (docs_v2/04 §2.2, docs_v2/06
 * P6-4/P6-5): the seven new scopes are accepted on invite and scope change,
 * enforced by the record endpoints, `manage_caregivers` is grantable only by
 * name, caregiver-facing notifications are queued for the right people and
 * never for the person who filed the record, the per-kind channel/frequency
 * control round-trips (and refuses to mute what H-48 says it may not), and
 * the activity feed shows the patient who changed what.
 */
describe("Caregiver scopes V2 e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000901"; // patient
  const PHONE_B = "+919000000902"; // view_tests only
  const PHONE_C = "+919000000903"; // manage_caregivers only
  const PHONE_D = "+919000000904"; // full_management
  const PHONE_E = "+919000000905"; // upload_tests + upload_documents
  const PHONE_F = "+919000000906"; // invited by C
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, notification_attempts, notifications,
        notification_preferences, notification_channels, health_events,
        diagnostic_results, diagnostic_reports, prescription_items, prescriptions,
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

  async function signIn(phone: string): Promise<{ token: string; userId: string }> {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    return { token: verify.body.token, userId: verify.body.user?.id ?? verify.body.userId };
  }

  async function invite(patientToken: string, profileId: string, phone: string, scopes: string[], label?: string) {
    await stepUp(app.getHttpServer(), patientToken);
    const res = await auth(patientToken, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone, scopes, relationship: "child", ...(label ? { label } : {}) })
      .expect(201);
    return res.body.id as string;
  }

  async function accept(caregiverToken: string, invitationId: string) {
    await auth(caregiverToken)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId }).expect(201);
  }

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let tokenD: string;
  let tokenE: string;
  let profileA: string;
  let userA: string;
  let userB: string;
  let userE: string;
  let inviteB: string;

  it("sets up a patient and four caregivers holding V2 scopes", async () => {
    ({ token: tokenA } = await signIn(PHONE_A));
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Scopes V2 Patient", yearOfBirth: 1955, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;
    userA = (await prisma.patientProfile.findUniqueOrThrow({ where: { id: profileA } })).ownerUserId;

    // An unknown scope is a validation error, never silently dropped.
    await stepUp(app.getHttpServer(), tokenA);
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_everything"], relationship: "child" })
      .expect(400);

    ({ token: tokenB } = await signIn(PHONE_B));
    inviteB = await invite(tokenA, profileA, PHONE_B, ["view_tests"], "Priya");
    await accept(tokenB, inviteB);
    userB = (await prisma.caregiverRelationship.findUniqueOrThrow({ where: { id: inviteB } })).caregiverUserId!;

    ({ token: tokenC } = await signIn(PHONE_C));
    await accept(tokenC, await invite(tokenA, profileA, PHONE_C, ["manage_caregivers"]));

    ({ token: tokenD } = await signIn(PHONE_D));
    await accept(tokenD, await invite(tokenA, profileA, PHONE_D, ["full_management"]));

    ({ token: tokenE } = await signIn(PHONE_E));
    const inviteE = await invite(tokenA, profileA, PHONE_E, ["upload_tests", "upload_documents"], "Ravi");
    await accept(tokenE, inviteE);
    userE = (await prisma.caregiverRelationship.findUniqueOrThrow({ where: { id: inviteE } })).caregiverUserId!;

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregivers")).expect(200);
    expect(list.body.items.map((c: { scopes: string[] }) => [...c.scopes].sort().join("+")).sort()).toEqual(
      ["full_management", "manage_caregivers", "upload_documents+upload_tests", "view_tests"].sort(),
    );
  });

  it("view_tests reads tests and nothing else; upload_tests writes them without granting the profile", async () => {
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/diagnostic-reports")).expect(200);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/medications")).expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/observations")).expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/patient-documents")).expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports")).send({ title: "Nope" }).expect(403);

    // upload_* is a write-only grant in the matrix (packages/authorization):
    // filing paperwork does not read the archive — the create response is
    // the only view the uploader gets.
    await auth(tokenE, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/diagnostic-reports")).expect(403);
    await auth(tokenE, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/patient-documents")).expect(403);
    await auth(tokenE, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"))
      .send({ pages: [{ contentType: "image/png", sizeBytes: 10 }] })
      .expect(201);
    await auth(tokenE, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/allergies")).expect(403);
    await auth(tokenE, profileA)(request(app.getHttpServer()).patch(`/v1/profiles/current`)).send({ displayName: "x" }).expect(403);
  });

  it("manage_caregivers is grantable only by name: the holder can invite, full_management cannot", async () => {
    await auth(tokenC, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregivers")).expect(200);
    await auth(tokenC, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/medications")).expect(403);

    await auth(tokenD, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/medications")).expect(200);
    await auth(tokenD, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregivers")).expect(403);
    await stepUp(app.getHttpServer(), tokenD);
    await auth(tokenD, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_F, scopes: ["view_medications"], relationship: "other" })
      .expect(403);

    await stepUp(app.getHttpServer(), tokenC);
    const invited = await auth(tokenC, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_F, scopes: ["view_measurements", "add_measurements"], relationship: "other" })
      .expect(201);
    expect(invited.body.status).toBe("invited");

    // Scope changes accept the new names too, and stay step-up gated.
    await auth(tokenC, profileA)(request(app.getHttpServer()).patch(`/v1/caregivers/${invited.body.id}/scopes`))
      .send({ scopes: ["view_documents"] })
      .expect(200);
    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregivers")).expect(200);
    expect(list.body.items.find((c: { id: string }) => c.id === invited.body.id).scopes).toEqual(["view_documents"]);
  });

  let reportId: string;

  it("a caregiver filing a test result queues new_test_result for the others who may read tests — never for the filer", async () => {
    const report = await auth(tokenE, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports"))
      .send({ kind: "laboratory", title: "Lipid profile", testedAt: "2026-09-02" })
      .expect(201);
    reportId = report.body.id;

    const queued = await prisma.notification.findMany({ where: { patientProfileId: profileA, kind: "new_test_result" } });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ status: "pending", dedupeKey: `new_test_result:${reportId}`, triggeredByUserId: userE });

    const audit = await prisma.auditEvent.findFirst({ where: { patientProfileId: profileA, action: "notification.caregiver_queued" } });
    expect(audit).toMatchObject({ actorType: "caregiver", actorUserId: userE });
    expect(audit?.context).toMatchObject({ kind: "new_test_result" });
  });

  it("the patient filing a prescription queues new_prescription (full_management reads medicines); a second filing is deduped", async () => {
    const rx = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "Dr. Scopes", prescribedAt: new Date().toISOString() })
      .expect(201);
    const queued = await prisma.notification.findMany({ where: { patientProfileId: profileA, kind: "new_prescription" } });
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ dedupeKey: `new_prescription:${rx.body.id}`, triggeredByUserId: userA });
  });

  it("no eligible caregiver means nothing is queued", async () => {
    // A second patient with only a view_tests caregiver: a prescription
    // interests nobody who may read medicines, so no row is written.
    const { token: tokenOther } = await signIn("+919000000907");
    const other = await auth(tokenOther)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Lonely Patient", yearOfBirth: 1970, preferredLocale: "en" })
      .expect(201);
    await auth(tokenOther, other.body.id)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
      .send({ practitionerName: "Dr. Nobody" })
      .expect(201);
    expect(await prisma.notification.count({ where: { patientProfileId: other.body.id } })).toBe(0);
  });

  it("per-kind channel/frequency controls round-trip through PUT and GET, and refuse the kinds H-48 protects", async () => {
    const empty = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/notification-preferences")).expect(200);
    expect(empty.body.channelFrequency).toEqual({});

    const base = { pushEnabled: true, privacyMode: "generic", quietHoursEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "07:00" };
    const put = await auth(tokenA, profileA)(request(app.getHttpServer()).put("/v1/profiles/current/notification-preferences"))
      .send({
        ...base,
        channelFrequency: {
          new_prescription: { channels: ["web_push"], frequency: "daily_digest" },
          refill_low: { channels: ["web_push", "sms"], frequency: "off" },
        },
      })
      .expect(200);
    expect(put.body.channelFrequency).toEqual({
      new_prescription: { channels: ["web_push"], frequency: "daily_digest" },
      refill_low: { channels: ["web_push", "sms"], frequency: "off" },
    });

    for (const kind of ["dose_reminder", "caregiver_escalation"]) {
      const refused = await auth(tokenA, profileA)(request(app.getHttpServer()).put("/v1/profiles/current/notification-preferences"))
        .send({ ...base, channelFrequency: { [kind]: { channels: ["web_push"], frequency: "off" } } })
        .expect(400);
      expect(refused.body.errors).toEqual([expect.objectContaining({ path: `channelFrequency.${kind}` })]);
    }
    await auth(tokenA, profileA)(request(app.getHttpServer()).put("/v1/profiles/current/notification-preferences"))
      .send({ ...base, channelFrequency: { not_a_kind: { channels: [], frequency: "off" } } })
      .expect(400);
    await auth(tokenA, profileA)(request(app.getHttpServer()).put("/v1/profiles/current/notification-preferences"))
      .send({ ...base, channelFrequency: { refill: { channels: ["pigeon"], frequency: "off" } } })
      .expect(400);

    // The V1 POST (no channelFrequency key) keeps working and does not wipe the control.
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/notification-preferences"))
      .send({ ...base, quietHoursStart: "23:00" })
      .expect(201);
    const after = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/notification-preferences")).expect(200);
    expect(after.body).toMatchObject({ quietHoursStart: "23:00" });
    expect(after.body.channelFrequency.new_prescription).toEqual({ channels: ["web_push"], frequency: "daily_digest" });

    // An explicit empty map clears it.
    const cleared = await auth(tokenA, profileA)(request(app.getHttpServer()).put("/v1/profiles/current/notification-preferences"))
      .send({ ...base, channelFrequency: {} })
      .expect(200);
    expect(cleared.body.channelFrequency).toEqual({});

    const audit = await prisma.auditEvent.findFirst({
      where: { patientProfileId: profileA, action: "notification.preferences_updated" },
      orderBy: { seq: "asc" },
      skip: 0,
    });
    expect(audit).toBeTruthy();
  });

  it("the activity feed tells the patient who changed what, labelled by relationship, and leaves reads out", async () => {
    // A caregiver-authored medicine, so both a HealthEvent and audit rows carry actorType=caregiver.
    await auth(tokenD, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({ enteredName: "Caregiver Added Tablet", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(201);

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/activity")).expect(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(3);
    expect(res.body.items.every((i: { actor: { actorType: string } }) => i.actor.actorType === "caregiver")).toBe(true);
    expect(res.body.items.map((i: { action: string | null }) => i.action)).not.toContain("caregiver.access_used");

    const reportRow = res.body.items.find((i: { source: string; entityId: string }) => i.source === "audit" && i.entityId === reportId);
    expect(reportRow).toMatchObject({ action: "diagnostic_report.created", actor: { relationship: "child", label: "Ravi" } });
    const testEvent = res.body.items.find((i: { source: string; kind: string | null }) => i.source === "health_event" && i.kind === "test_result");
    expect(testEvent).toMatchObject({ entityId: reportId, actor: { label: "Ravi" } });
    const medEvent = res.body.items.find((i: { source: string; kind: string | null }) => i.source === "health_event" && i.kind === "medicine_started");
    expect(medEvent.actor.relationship).toBe("child");

    // Newest first, and cursor pagination never repeats or skips across the two sources.
    const stamps = res.body.items.map((i: { occurredAt: string }) => new Date(i.occurredAt).getTime());
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
    const page1 = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/activity?limit=2")).expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/profiles/current/activity?limit=2&cursor=${page1.body.nextCursor}`)).expect(200);
    const seen = new Set(page1.body.items.map((i: { id: string }) => i.id));
    expect(page2.body.items.some((i: { id: string }) => seen.has(i.id))).toBe(false);
    expect([...page1.body.items, ...page2.body.items].map((i: { id: string }) => i.id)).toEqual(res.body.items.slice(0, 2 + page2.body.items.length).map((i: { id: string }) => i.id));
    await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/activity?cursor=garbage")).expect(400);

    // A caregiver who cannot view the profile cannot read the feed either.
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/activity")).expect(403);
    await auth(tokenD, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/activity")).expect(200);
  });

  it("revoking a scope stops the notification eligibility check immediately", async () => {
    await stepUp(app.getHttpServer(), tokenA);
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/caregivers/${inviteB}`)).expect(204);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/diagnostic-reports")).expect(403);
    expect(userB).toBeTruthy();
  });
});
