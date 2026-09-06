import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { addDaysToDateString, dateStringInTz } from "@medpass/domain";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { authHeaders, patientSignIn } from "./helpers/provider";

/**
 * P17 test-due schedules (docs_v2/05 §12): CRUD on
 * `profiles/current/test-due`, `lastDoneOn` derived from the latest matching
 * DiagnosticReport, the view_tests / upload_tests split for caregivers,
 * idempotent create, and the audit trail.
 */
describe("Test-due schedules e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  const OWNER_PHONE = "+919000000871";
  const VIEWER_PHONE = "+919000000872";
  const PLANNER_PHONE = "+919000000873";

  let ownerToken: string;
  let viewerToken: string;
  let plannerToken: string;
  let profileId: string;
  let today: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, offline_mutations, notifications, test_due_schedules,
        diagnostic_results, diagnostic_reports, caregiver_permissions, caregiver_relationships,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    ownerToken = await patientSignIn(server(), OWNER_PHONE);
    const profile = await authHeaders(ownerToken)(request(server()).post("/v1/profiles"))
      .send({ displayName: "Test Due Owner", yearOfBirth: 1975, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
    today = dateStringInTz("Asia/Kolkata");

    // Two caregivers seeded straight into the relationship tables (the
    // invite flow is covered elsewhere): one may only view tests, one may plan them.
    viewerToken = await patientSignIn(server(), VIEWER_PHONE);
    plannerToken = await patientSignIn(server(), PLANNER_PHONE);
    const owner = await prisma.patientProfile.findUniqueOrThrow({ where: { id: profileId } });
    for (const [phone, scope] of [
      [VIEWER_PHONE, "view_tests"],
      [PLANNER_PHONE, "upload_tests"],
    ] as const) {
      const session = await prisma.session.findFirst({ where: { user: { phoneDigest: (await import("../src/common/crypto")).phoneDigest(phone) } }, select: { userId: true } });
      await prisma.caregiverRelationship.create({
        data: {
          patientProfileId: profileId,
          caregiverUserId: session!.userId,
          invitedPhoneDigest: `d-${randomUUID()}`,
          relationship: "child",
          status: "active",
          acceptedAt: new Date(),
          permissions: { create: [{ scope, grantedByUserId: owner.ownerUserId }] },
        },
      });
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it("starts empty", async () => {
    const res = await authHeaders(ownerToken, profileId)(request(server()).get("/v1/profiles/current/test-due")).expect(200);
    expect(res.body.items).toEqual([]);
  });

  it("refuses a schedule that names neither an analyte nor a report kind, or neither a date nor an interval", async () => {
    const a = await authHeaders(ownerToken, profileId)(request(server()).post("/v1/profiles/current/test-due"))
      .send({ label: "Something", intervalDays: 90 })
      .expect(400);
    expect(a.body.code).toBe("validation_failed");
    const b = await authHeaders(ownerToken, profileId)(request(server()).post("/v1/profiles/current/test-due"))
      .send({ label: "HbA1c", analyteKey: "hba1c" })
      .expect(400);
    expect(b.body.errors.some((e: { path: string }) => e.path === "nextDueOn")).toBe(true);
  });

  let recurringId: string;

  it("plans a recurring analyte test: with no prior result the interval is anchored on today", async () => {
    const res = await authHeaders(ownerToken, profileId)(request(server()).post("/v1/profiles/current/test-due"))
      .send({ label: "HbA1c", analyteKey: "hba1c", intervalDays: 90 })
      .expect(201);
    recurringId = res.body.id;
    expect(res.body).toMatchObject({ label: "HbA1c", analyteKey: "hba1c", diagnosticKind: null, intervalDays: 90, status: "pending", lastDoneOn: null });
    expect(res.body.nextDueOn).toBe(addDaysToDateString(today, 90));

    const audit = await prisma.auditEvent.findFirst({ where: { action: "test_due.created", patientProfileId: profileId } });
    expect(audit?.entityId).toBe(recurringId);
    expect(JSON.stringify(audit?.context)).not.toContain("HbA1c");
  });

  it("derives lastDoneOn from the latest matching DiagnosticReport and anchors a new interval on it", async () => {
    await prisma.diagnosticReport.create({
      data: {
        patientProfileId: profileId,
        kind: "laboratory",
        title: "Diabetes panel",
        testedAt: new Date("2026-06-01T00:00:00Z"),
        results: { create: [{ patientProfileId: profileId, analyteKey: "hba1c", enteredValueText: "6.9" }] },
      },
    });
    await prisma.diagnosticReport.create({
      data: {
        patientProfileId: profileId,
        kind: "laboratory",
        title: "Older panel",
        testedAt: new Date("2026-01-15T00:00:00Z"),
        results: { create: [{ patientProfileId: profileId, analyteKey: "hba1c", enteredValueText: "7.4" }] },
      },
    });

    const list = await authHeaders(ownerToken, profileId)(request(server()).get("/v1/profiles/current/test-due")).expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === recurringId).lastDoneOn).toBe("2026-06-01");

    const res = await authHeaders(ownerToken, profileId)(request(server()).post("/v1/profiles/current/test-due"))
      .send({ label: "HbA1c (from last result)", analyteKey: "hba1c", intervalDays: 120 })
      .expect(201);
    expect(res.body.nextDueOn).toBe("2026-09-29"); // 2026-06-01 + 120 days
    expect(res.body.lastDoneOn).toBe("2026-06-01");
  });

  it("plans a one-off by report kind with an explicit date", async () => {
    const res = await authHeaders(ownerToken, profileId)(request(server()).post("/v1/profiles/current/test-due"))
      .send({ label: "Chest X-ray", diagnosticKind: "imaging", nextDueOn: "2027-01-10" })
      .expect(201);
    expect(res.body).toMatchObject({ diagnosticKind: "imaging", analyteKey: null, intervalDays: null, nextDueOn: "2027-01-10", lastDoneOn: null });
  });

  it("is idempotent on create with the same Idempotency-Key", async () => {
    const key = randomUUID();
    const body = { label: "Lipids", analyteKey: "ldl", intervalDays: 180 };
    const first = await authHeaders(ownerToken, profileId)(request(server()).post("/v1/profiles/current/test-due")).set("idempotency-key", key).send(body).expect(201);
    const second = await authHeaders(ownerToken, profileId)(request(server()).post("/v1/profiles/current/test-due")).set("idempotency-key", key).send(body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.testDueSchedule.count({ where: { patientProfileId: profileId, analyteKey: "ldl" } })).toBe(1);
  });

  it("dismisses, then re-arms with a new date", async () => {
    const dismissed = await authHeaders(ownerToken, profileId)(request(server()).patch(`/v1/profiles/current/test-due/${recurringId}`))
      .send({ status: "dismissed" })
      .expect(200);
    expect(dismissed.body.status).toBe("dismissed");

    const rearmed = await authHeaders(ownerToken, profileId)(request(server()).patch(`/v1/profiles/current/test-due/${recurringId}`))
      .send({ nextDueOn: "2026-12-01" })
      .expect(200);
    expect(rearmed.body).toMatchObject({ status: "pending", nextDueOn: "2026-12-01" });

    await authHeaders(ownerToken, profileId)(request(server()).patch(`/v1/profiles/current/test-due/${recurringId}`)).send({}).expect(400);
    expect(await prisma.auditEvent.count({ where: { action: "test_due.updated", entityId: recurringId } })).toBe(2);
  });

  it("a caregiver with view_tests can read but not plan; one with upload_tests can plan", async () => {
    await authHeaders(viewerToken, profileId)(request(server()).get("/v1/profiles/current/test-due")).expect(200);
    const forbidden = await authHeaders(viewerToken, profileId)(request(server()).post("/v1/profiles/current/test-due"))
      .send({ label: "TSH", analyteKey: "tsh", intervalDays: 365 })
      .expect(403);
    expect(forbidden.body.code).toBe("caregiver_scope_missing");
    await authHeaders(viewerToken, profileId)(request(server()).patch(`/v1/profiles/current/test-due/${recurringId}`)).send({ status: "done" }).expect(403);

    const planned = await authHeaders(plannerToken, profileId)(request(server()).post("/v1/profiles/current/test-due"))
      .send({ label: "TSH", analyteKey: "tsh", intervalDays: 365 })
      .expect(201);
    expect(planned.body.status).toBe("pending");
  });

  it("soft-deletes: gone from the list and 404 afterwards, row kept", async () => {
    await authHeaders(ownerToken, profileId)(request(server()).delete(`/v1/profiles/current/test-due/${recurringId}`)).expect(204);
    await authHeaders(ownerToken, profileId)(request(server()).get(`/v1/profiles/current/test-due/${recurringId}`)).expect(404);
    await authHeaders(ownerToken, profileId)(request(server()).delete(`/v1/profiles/current/test-due/${recurringId}`)).expect(404);
    const row = await prisma.testDueSchedule.findUnique({ where: { id: recurringId } });
    expect(row?.deletedAt).toBeTruthy();
    expect(await prisma.auditEvent.count({ where: { action: "test_due.deleted", entityId: recurringId } })).toBe(1);
  });

  it("another user's profile is a 404, never a peek", async () => {
    const stranger = await patientSignIn(server(), "+919000000874");
    const res = await authHeaders(stranger, profileId)(request(server()).get("/v1/profiles/current/test-due")).expect(403);
    expect(res.body.code).toBe("caregiver_scope_missing");
  });
});
