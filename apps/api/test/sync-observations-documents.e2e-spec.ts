import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * `POST /v1/sync` for the two entities docs_v2/05 §14 registers:
 * `observation/create` (a reading captured offline) and
 * `document_upload_intent/create` (a document captured offline whose pages
 * the client uploaded on reconnect). Replay, idempotent double-replay, and
 * the conflicting replays — a reading deleted on another device, a document
 * deleted or never finished — each reported per item and never aborting
 * the batch.
 */
describe("Sync e2e — observations and document upload intents", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000701";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
  const PAGE = readFileSync(join(__dirname, "fixtures/prescription-page-1.png"));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, offline_mutations, background_jobs, health_events,
        document_candidates, document_extractions, document_pages, patient_documents, stored_objects,
        observations, measurement_devices, dose_events, scheduled_doses, medication_schedules,
        medication_changes, medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents, caregiver_permissions,
        caregiver_relationships, sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  let token: string;
  let profileId: string;

  const sync = (mutations: unknown[]) => auth(token, profileId)(request(app.getHttpServer()).post("/v1/sync")).send({ mutations, profileId });

  const observationEnvelope = (clientMutationId: string, payload: Record<string, unknown>) => ({
    clientMutationId,
    entity: "observation",
    operation: "create",
    profileId,
    capturedAt: new Date().toISOString(),
    payload,
  });

  const intentEnvelope = (clientMutationId: string, documentId: string) => ({
    clientMutationId,
    entity: "document_upload_intent",
    operation: "create",
    profileId,
    capturedAt: new Date().toISOString(),
    payload: { documentId, kind: "prescription", sourceChannel: "camera", pageCount: 1 },
  });

  async function createDocumentWithPage(uploadIt: boolean, idempotencyKey?: string) {
    const req = auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"));
    if (idempotencyKey) req.set("idempotency-key", idempotencyKey);
    const created = await req
      .send({ kind: "prescription", sourceChannel: "camera", pages: [{ contentType: "image/png", sizeBytes: PAGE.length }] })
      .expect(201);
    if (uploadIt) {
      const uploadPath = (created.body.pages[0].uploadUrl as string).replace(/^https?:\/\/[^/]+/, "");
      await request(app.getHttpServer()).put(uploadPath).set("content-type", "image/png").send(PAGE).expect(200);
      await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/patient-documents/${created.body.id}/pages/1/complete`)).expect(201);
    }
    return created.body as { id: string };
  }

  it("signs in and creates a profile", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;
    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Offline Capture", yearOfBirth: 1970, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  // ───────────────────────── observation/create ─────────────────────────

  const bpMutationId = randomUUID();
  const bpMeasuredAt = "2026-09-01T03:30:00.000Z";

  it("replays a blood pressure captured offline: one BP row plus its pulse, keyed on the client mutation id", async () => {
    const res = await sync([
      observationEnvelope(bpMutationId, {
        concept: "blood_pressure",
        valueNumeric: 128,
        valueNumeric2: 82,
        pulseBpm: 71,
        context: "sitting",
        measuredAt: bpMeasuredAt,
        enteredValueText: "128/82",
      }),
    ]).expect(201);
    expect(res.body.applied).toEqual([bpMutationId]);
    expect(res.body.conflicts).toEqual([]);

    const list = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/observations")).expect(200);
    const bp = list.body.items.filter((o: { concept: string }) => o.concept === "blood_pressure");
    const pulse = list.body.items.filter((o: { concept: string }) => o.concept === "heart_rate");
    expect(bp).toHaveLength(1);
    expect(pulse).toHaveLength(1);
    expect(bp[0]).toMatchObject({ valueNumeric: "128", valueNumeric2: "82", clientMutationId: bpMutationId, context: "sitting", provenanceSource: "user_entered" });
  });

  it("a double replay of the same mutation is applied again but never double-inserts", async () => {
    const res = await sync([
      observationEnvelope(bpMutationId, {
        concept: "blood_pressure",
        valueNumeric: 128,
        valueNumeric2: 82,
        pulseBpm: 71,
        context: "sitting",
        measuredAt: bpMeasuredAt,
        enteredValueText: "128/82",
      }),
    ]).expect(201);
    expect(res.body.applied).toEqual([bpMutationId]);
    expect(res.body.conflicts).toEqual([]);

    expect(await prisma.observation.count({ where: { patientProfileId: profileId, concept: "blood_pressure" } })).toBe(1);
    expect(await prisma.observation.count({ where: { patientProfileId: profileId, concept: "heart_rate" } })).toBe(1);
  });

  it("the direct endpoint honours the same key: a retried POST with a clientMutationId returns the existing row", async () => {
    const key = randomUUID();
    const body = { concept: "body_weight", valueNumeric: 71.5, measuredAt: "2026-09-01T04:00:00.000Z", clientMutationId: key };
    const first = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/observations")).send(body).expect(201);
    const second = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/observations")).send(body).expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.observation.count({ where: { patientProfileId: profileId, concept: "body_weight" } })).toBe(1);
  });

  it("a reading deleted on another device before the replay lands comes back as a `deleted` conflict, not a resurrection", async () => {
    const list = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/observations")).expect(200);
    const bp = list.body.items.find((o: { concept: string }) => o.concept === "blood_pressure");
    await auth(token, profileId)(request(app.getHttpServer()).delete(`/v1/observations/${bp.id}`)).expect(204);

    const otherId = randomUUID();
    const res = await sync([
      observationEnvelope(bpMutationId, { concept: "blood_pressure", valueNumeric: 128, valueNumeric2: 82, measuredAt: bpMeasuredAt }),
      // A second, unrelated reading in the same batch still applies.
      observationEnvelope(otherId, { concept: "spo2", valueNumeric: 97, measuredAt: "2026-09-01T05:00:00.000Z" }),
    ]).expect(201);

    expect(res.body.applied).toEqual([otherId]);
    expect(res.body.conflicts).toHaveLength(1);
    expect(res.body.conflicts[0]).toMatchObject({ clientMutationId: bpMutationId, kind: "deleted" });
    expect(res.body.conflicts[0].serverState.id).toBe(bp.id);

    const after = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/observations")).expect(200);
    expect(after.body.items.some((o: { concept: string }) => o.concept === "blood_pressure")).toBe(false);
    expect(after.body.items.some((o: { concept: string }) => o.concept === "spo2")).toBe(true);
  });

  it("an implausible reading or a client-set interpretation is an `invalid` conflict — the server's checks are not bypassed offline", async () => {
    const typo = randomUUID();
    const interpreted = randomUUID();
    const res = await sync([
      observationEnvelope(typo, { concept: "spo2", valueNumeric: 140, measuredAt: "2026-09-01T06:00:00.000Z" }),
      observationEnvelope(interpreted, { concept: "spo2", valueNumeric: 95, interpretation: "low", measuredAt: "2026-09-01T06:05:00.000Z" }),
    ]).expect(201);
    expect(res.body.applied).toEqual([]);
    expect(res.body.conflicts.map((c: { kind: string }) => c.kind)).toEqual(["invalid", "invalid"]);
  });

  it("reports an `observations` change signal on the next poll, so the diary refreshes after a replay", async () => {
    const first = await sync([]).expect(201);
    const cursor = first.body.nextCursor;
    await sync([observationEnvelope(randomUUID(), { concept: "body_temperature", valueNumeric: 37.1, measuredAt: new Date().toISOString() })]).expect(201);
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/sync")).send({ mutations: [], cursor, profileId }).expect(201);
    expect(res.body.changes).toEqual(expect.arrayContaining([{ profileId, scope: "observations" }]));
  });

  // ───────────────────────── document_upload_intent/create ─────────────────────────

  const intentId = randomUUID();
  let documentId: string;

  it("the create step is idempotent on the client mutation id, so a retried offline replay never makes a second document", async () => {
    const first = await createDocumentWithPage(false, intentId);
    const again = await createDocumentWithPage(false, intentId);
    expect(again.id).toBe(first.id);
    documentId = first.id;
    expect(await prisma.patientDocument.count({ where: { patientProfileId: profileId } })).toBe(1);
  });

  it("an intent for a document whose pages never finished uploading is `invalid`, and nothing is queued", async () => {
    const res = await sync([intentEnvelope(intentId, documentId)]).expect(201);
    expect(res.body.applied).toEqual([]);
    expect(res.body.conflicts).toEqual([{ clientMutationId: intentId, kind: "invalid" }]);
    expect(await prisma.backgroundJob.count({ where: { queue: "document_classify" } })).toBe(0);
  });

  it("once the page is uploaded and complete, the intent applies and the document is processing", async () => {
    // The client's resume path: the idempotent create replays the same
    // document with its original upload authorization, which is then used.
    const replayed = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"))
      .set("idempotency-key", intentId)
      .send({ kind: "prescription", sourceChannel: "camera", pages: [{ contentType: "image/png", sizeBytes: PAGE.length }] })
      .expect(201);
    expect(replayed.body.id).toBe(documentId);
    const uploadPath = (replayed.body.pages[0].uploadUrl as string).replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer()).put(uploadPath).set("content-type", "image/png").send(PAGE).expect(200);
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/patient-documents/${documentId}/pages/1/complete`)).expect(201);

    const res = await sync([intentEnvelope(intentId, documentId)]).expect(201);
    expect(res.body.applied).toEqual([intentId]);
    expect(res.body.conflicts).toEqual([]);

    const doc = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}`)).expect(200);
    expect(doc.body.status).toBe("processing");
    expect(doc.body.kind).toBe("prescription");
    expect(doc.body.pageCount).toBe(1);
    expect(await prisma.backgroundJob.count({ where: { queue: "document_classify" } })).toBe(1);
  }, 60000);

  it("a double replay of the fulfilled intent is applied again and queues nothing more", async () => {
    const res = await sync([intentEnvelope(intentId, documentId)]).expect(201);
    expect(res.body.applied).toEqual([intentId]);
    expect(await prisma.backgroundJob.count({ where: { queue: "document_classify" } })).toBe(1);
    expect(await prisma.patientDocument.count({ where: { patientProfileId: profileId } })).toBe(1);
  });

  it("an intent whose document was deleted in the meantime is a `deleted` conflict; a never-created id too", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).delete(`/v1/patient-documents/${documentId}`)).expect(204);
    const ghost = randomUUID();
    const res = await sync([intentEnvelope(intentId, documentId), intentEnvelope(ghost, randomUUID())]).expect(201);
    expect(res.body.applied).toEqual([]);
    expect(res.body.conflicts).toHaveLength(2);
    expect(res.body.conflicts[0]).toMatchObject({ clientMutationId: intentId, kind: "deleted" });
    expect(res.body.conflicts[0].serverState).toMatchObject({ id: documentId, status: "deleted" });
    expect(res.body.conflicts[1]).toMatchObject({ clientMutationId: ghost, kind: "deleted" });
  });

  it("a whole document uploaded outside the intent still applies (the fulfilment record is what matters)", async () => {
    const doc = await createDocumentWithPage(true);
    const res = await sync([intentEnvelope(randomUUID(), doc.id)]).expect(201);
    expect(res.body.applied).toHaveLength(1);
    expect(res.body.conflicts).toEqual([]);
  }, 60000);

  it("reports a `documents` change signal on the next poll", async () => {
    const first = await sync([]).expect(201);
    await createDocumentWithPage(false);
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/sync")).send({ mutations: [], cursor: first.body.nextCursor, profileId }).expect(201);
    expect(res.body.changes).toEqual(expect.arrayContaining([{ profileId, scope: "documents" }]));
  });
});
