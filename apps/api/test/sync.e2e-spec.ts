import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 5 follow-up e2e: `POST /v1/sync`, the generic batch endpoint every
 * offline-capable mutation replays through (docs/15) — dispatch by
 * entity/operation, idempotent replay, row-version conflicts, permission
 * revocation, and unsupported-entity handling, none of which abort the rest
 * of a batch.
 */
describe("Sync e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000601";
  const PHONE_B = "+919000000602";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, offline_mutations, dose_events, scheduled_doses,
        medication_schedules, medication_changes, medication_instructions,
        patient_medications, practitioners, patient_allergies, patient_conditions,
        consent_events, consents, caregiver_permissions, caregiver_relationships,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  });

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
    const res = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    return res.body.token;
  }

  let tokenA: string;
  let profileId: string;

  it("signs in and creates a profile", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Sync Test", yearOfBirth: 1980, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  let medicationId: string;
  let rowVersion: number;

  it("applies a patient_medication create mutation through the sync endpoint", async () => {
    const clientMutationId = randomUUID();
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId,
            entity: "patient_medication",
            operation: "create",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: {
              enteredName: "Sync Test Medicine",
              source: "manual",
              instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
            },
          },
        ],
      })
      .expect(201);

    expect(res.body.applied).toEqual([clientMutationId]);
    expect(res.body.conflicts).toEqual([]);

    const list = await auth(tokenA, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/medications")).expect(
      200,
    );
    const created = list.body.items.find((m: { enteredName: string }) => m.enteredName === "Sync Test Medicine");
    expect(created).toBeTruthy();
    medicationId = created.id;
    rowVersion = created.rowVersion;

    // Replaying the exact same batch is a no-op, not a duplicate.
    const replay = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId,
            entity: "patient_medication",
            operation: "create",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: {
              enteredName: "Sync Test Medicine",
              source: "manual",
              instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
            },
          },
        ],
      })
      .expect(201);
    expect(replay.body.applied).toEqual([clientMutationId]);

    const listAfterReplay = await auth(tokenA, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/medications"),
    ).expect(200);
    expect(listAfterReplay.body.items.filter((m: { enteredName: string }) => m.enteredName === "Sync Test Medicine")).toHaveLength(
      1,
    );
  });

  it("applies a patient_medication update mutation through the sync endpoint", async () => {
    const clientMutationId = randomUUID();
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId,
            entity: "patient_medication",
            operation: "update",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: { id: medicationId, rowVersion, patientReason: "Queued while offline" },
          },
        ],
      })
      .expect(201);
    expect(res.body.applied).toEqual([clientMutationId]);

    const detail = await auth(tokenA, profileId)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(
      200,
    );
    expect(detail.body.patientReason).toBe("Queued while offline");
    rowVersion = detail.body.rowVersion;
  });

  it("a stale rowVersion on a non-clinical-only edit auto-merges against the current version, not reported as a conflict", async () => {
    const clientMutationId = randomUUID();
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId,
            entity: "patient_medication",
            operation: "update",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: { id: medicationId, rowVersion: rowVersion - 1, patientReason: "Stale but disjoint edit" },
          },
        ],
      })
      .expect(201);

    expect(res.body.conflicts).toEqual([]);
    expect(res.body.applied).toEqual([clientMutationId]);

    const detail = await auth(tokenA, profileId)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(detail.body.patientReason).toBe("Stale but disjoint edit");
    rowVersion = detail.body.rowVersion;
  });

  it("a stale rowVersion on a pure dose/frequency edit still reports a genuine row_version conflict — never auto-merged", async () => {
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId: randomUUID(),
            entity: "patient_medication",
            operation: "update",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: {
              id: medicationId,
              rowVersion: rowVersion - 1,
              instruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "BD" },
            },
          },
        ],
      })
      .expect(201);

    expect(res.body.applied).toEqual([]);
    expect(res.body.conflicts).toHaveLength(1);
    expect(res.body.conflicts[0].kind).toBe("row_version");
    expect(res.body.conflicts[0].serverState.patientReason).toBe("Stale but disjoint edit");

    const detail = await auth(tokenA, profileId)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(detail.body.instruction.frequencyCode).not.toBe("BD"); // the clinical edit was never applied
  });

  it("a stale mixed edit (safe field + instruction) applies the safe field and reports only the instruction as unmerged", async () => {
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId: randomUUID(),
            entity: "patient_medication",
            operation: "update",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: {
              id: medicationId,
              rowVersion: rowVersion - 1,
              patientReason: "Mixed edit: reason changed",
              instruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "BD" },
            },
          },
        ],
      })
      .expect(201);

    expect(res.body.applied).toEqual([]);
    expect(res.body.conflicts).toHaveLength(1);
    expect(res.body.conflicts[0].kind).toBe("field_conflict");
    expect(res.body.conflicts[0].unmergedFields).toEqual(["instruction"]);
    // The safe field is reflected in the returned serverState immediately...
    expect(res.body.conflicts[0].serverState.patientReason).toBe("Mixed edit: reason changed");

    // ...and genuinely persisted, while the clinical field was left untouched.
    const detail = await auth(tokenA, profileId)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(detail.body.patientReason).toBe("Mixed edit: reason changed");
    expect(detail.body.instruction.frequencyCode).not.toBe("BD");
    rowVersion = detail.body.rowVersion;
  });

  it("reports an unsupported entity as an invalid conflict without aborting the rest of the batch", async () => {
    const validId = randomUUID();
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId: randomUUID(),
            entity: "allergy",
            operation: "create",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: { label: "Dust" },
          },
          {
            clientMutationId: validId,
            entity: "patient_medication",
            operation: "update",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: { id: medicationId, rowVersion, patientReason: "Still applies after the invalid item" },
          },
        ],
      })
      .expect(201);

    expect(res.body.applied).toEqual([validId]);
    expect(res.body.conflicts).toHaveLength(1);
    expect(res.body.conflicts[0].kind).toBe("invalid");
  });

  it("records a dose_event mutation through the sync endpoint", async () => {
    const timeline = await auth(tokenA, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/timeline")).expect(
      200,
    );
    const item = timeline.body.items[0];
    expect(item).toBeTruthy();

    const clientMutationId = randomUUID();
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId,
            entity: "dose_event",
            operation: "create",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: { scheduledDoseId: item.scheduledDoseId, action: "taken", clientMutationId },
          },
        ],
      })
      .expect(201);
    expect(res.body.applied).toEqual([clientMutationId]);

    const after = await auth(tokenA, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/timeline")).expect(
      200,
    );
    expect(after.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === item.scheduledDoseId).status).toBe(
      "taken",
    );
  });

  let cursor: string;

  it("a first sync with no cursor reports no changes, but returns one to use next time", async () => {
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({ mutations: [], profileId })
      .expect(201);
    expect(res.body.changes).toEqual([]);
    expect(typeof res.body.nextCursor).toBe("string");
    cursor = res.body.nextCursor;
  });

  it("polling again immediately with that cursor reports nothing new", async () => {
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({ mutations: [], cursor, profileId })
      .expect(201);
    expect(res.body.changes).toEqual([]);
  });

  it("reports a medications change signal once something changed since the cursor", async () => {
    const current = await auth(tokenA, profileId)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    await auth(tokenA, profileId)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: current.body.rowVersion, patientReason: "Changed after the cursor" })
      .expect(200);

    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({ mutations: [], cursor, profileId })
      .expect(201);
    expect(res.body.changes).toEqual(expect.arrayContaining([{ profileId, scope: "medications" }]));
    cursor = res.body.nextCursor;
  });

  it("reports a timeline change signal with the affected date once a dose is recorded", async () => {
    // Today's one OD slot was already recorded "taken" by an earlier test — use tomorrow's, which is still "upcoming".
    const tomorrow = new Date(Date.now() + 5.5 * 60 * 60 * 1000 + 86_400_000).toISOString().slice(0, 10);
    const timeline = await auth(tokenA, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${tomorrow}`),
    ).expect(200);
    const item = timeline.body.items.find((i: { status: string }) => i.status === "upcoming");
    expect(item).toBeTruthy();

    await auth(tokenA, profileId)(request(app.getHttpServer()).post(`/v1/doses/${item.scheduledDoseId}/events`))
      .send({ action: "taken" })
      .expect(201);

    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({ mutations: [], cursor, profileId })
      .expect(201);
    const timelineChange = res.body.changes.find((c: { scope: string }) => c.scope === "timeline");
    expect(timelineChange).toBeTruthy();
    expect(timelineChange.profileId).toBe(profileId);
    expect(timelineChange.dates).toEqual(expect.arrayContaining([timeline.body.date]));
  });

  it("reports no changes when profileId is omitted, even with a cursor and real changes since", async () => {
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({ mutations: [], cursor })
      .expect(201);
    expect(res.body.changes).toEqual([]);
  });

  it("rejects a request signed in as nobody", async () => {
    await request(app.getHttpServer())
      .post("/v1/sync")
      .send({ mutations: [] })
      .expect(401);
  });

  it("reports a caregiver's out-of-scope mutation as permission_revoked without touching the rest of the batch", async () => {
    await prisma.otpAttempt.deleteMany({});
    const tokenB = await signIn(PHONE_B);

    const invite = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "other" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept"))
      .send({ invitationId: invite.body.id })
      .expect(201);

    const validId = randomUUID();
    const res = await auth(tokenB, profileId)(request(app.getHttpServer()).post("/v1/sync"))
      .send({
        mutations: [
          {
            clientMutationId: randomUUID(),
            entity: "patient_medication",
            operation: "create",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: {
              enteredName: "Not allowed",
              source: "manual",
              instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
            },
          },
          {
            clientMutationId: validId,
            entity: "patient_medication",
            operation: "update",
            profileId,
            capturedAt: new Date().toISOString(),
            payload: { id: medicationId, rowVersion, patientReason: "View-only caregiver cannot edit, but this ID is separate" },
          },
        ],
      })
      .expect(201);

    expect(res.body.conflicts.filter((c: { kind: string }) => c.kind === "permission_revoked")).toHaveLength(2);
    expect(res.body.applied).toEqual([]);
  });

  it("rejects a batch over the 50-mutation cap", async () => {
    const mutations = Array.from({ length: 51 }, () => ({
      clientMutationId: randomUUID(),
      entity: "dose_event",
      operation: "create",
      profileId,
      capturedAt: new Date().toISOString(),
      payload: {},
    }));
    const res = await auth(tokenA, profileId)(request(app.getHttpServer()).post("/v1/sync")).send({ mutations }).expect(400);
    expect(res.body.code).toBe("validation_failed");
  });
});
