import "reflect-metadata";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { GATEWAY_ENV } from "./callbacks.controller";
import { INTERNAL_TOKEN } from "./internal.guard";
import { InternalController, MOCK_GATEWAY } from "./internal.controller";
import { MockGatewayService, loadFixtures } from "./mock";
import { InMemoryTransactionStore, TRANSACTION_STORE } from "./transactions";

const TOKEN = "internal-spec-token-not-secret";
const FIXTURES = join(__dirname, "..", "fixtures");

/**
 * `/internal/*` (docs_v2/08 §4): token-guarded, MOCK=true replays the recorded fixtures, every
 * call leaves an outbound AbdmTransaction. No database: in-memory store.
 */
describe("internal API in MOCK mode", () => {
  let app: INestApplication;
  let store: InMemoryTransactionStore;

  beforeAll(async () => {
    store = new InMemoryTransactionStore();
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalController],
      providers: [
        { provide: TRANSACTION_STORE, useValue: store },
        { provide: MOCK_GATEWAY, useValue: new MockGatewayService(loadFixtures(FIXTURES)) },
        { provide: GATEWAY_ENV, useValue: "mock" },
        { provide: INTERNAL_TOKEN, useValue: TOKEN },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const authed = (req: request.Test) => req.set("x-abdm-internal-token", TOKEN);

  it("refuses calls without the internal token (constant-time compare, bare 401)", async () => {
    await api().get("/internal/health").expect(401);
    await api().get("/internal/health").set("x-abdm-internal-token", "wrong").expect(401);
    await api().get("/internal/health").set("x-abdm-internal-token", `${TOKEN}x`).expect(401);
    const res = await authed(api().get("/internal/health")).expect(200);
    expect(res.body).toEqual({ ok: true, mock: true, gatewayEnv: "mock" });
  });

  it("replays link init → verify with the fixture OTP and records outbound transactions", async () => {
    const init = await authed(api().post("/internal/abha/link/init")).send({ method: "abha_number", abhaNumber: "91-1234-5678-9012", correlationId: "cid-1" }).expect(201);
    expect(init.body.transactionId).toMatch(/^mock-link-/);
    expect(init.body.otpSentTo).toBe("******9012");

    const wrong = await authed(api().post("/internal/abha/link/verify")).send({ transactionId: init.body.transactionId, otp: "999999" }).expect(400);
    expect(wrong.body.code).toBe("otp_invalid");
    await authed(api().post("/internal/abha/link/verify")).send({ transactionId: "mock-link-nope", otp: "000000" }).expect(404);

    const ok = await authed(api().post("/internal/abha/link/verify")).send({ transactionId: init.body.transactionId, otp: "000000", correlationId: "cid-1" }).expect(201);
    expect(ok.body).toMatchObject({ abhaNumber: "91-1234-5678-9012", profile: { name: "ABDM Sandbox Patient" } });
    expect(ok.body.abhaAddress).toMatch(/@sbx$/);
    expect("otp" in ok.body).toBe(false);

    const kinds = store.rows.map((r) => [r.kind, r.status, r.correlationId]);
    expect(kinds).toEqual(
      expect.arrayContaining([
        ["abha.link.init", "completed", "cid-1"],
        ["abha.link.verify", "failed", null],
        ["abha.link.verify", "completed", "cid-1"],
      ]),
    );
    expect(store.rows.find((r) => r.kind === "abha.link.verify" && r.status === "failed")?.errorCode).toBe("otp_invalid");
    expect(store.rows.every((r) => r.direction === "outbound" && r.gatewayEnv === "mock")).toBe(true);
  });

  it("replays discovery, care-context linking (OTP required) and serves the transferred bundle", async () => {
    const started = await authed(api().post("/internal/discover")).send({ abhaAddress: "asha@sbx", abhaNumber: "91-1234-5678-9012" }).expect(201);
    const found = await authed(api().get(`/internal/discover/${started.body.transactionId}`)).expect(200);
    expect(found.body.status).toBe("completed");
    expect(found.body.patients[0]).toMatchObject({ hipId: "mock-hip-001" });
    expect(found.body.patients[0].careContexts).toHaveLength(2);
    const unknown = await authed(api().get("/internal/discover/mock-discover-unknown")).expect(200);
    expect(unknown.body.status).toBe("failed");

    const body = { transactionId: started.body.transactionId, abhaAddress: "asha@sbx", hipId: "mock-hip-001", patientReferenceNumber: "PRN-1", careContextReferences: ["OPD-2026-0001"] };
    const pending = await authed(api().post("/internal/care-contexts/link")).send(body).expect(201);
    expect(pending.body.status).toBe("otp_required");
    await authed(api().post("/internal/care-contexts/link")).send({ ...body, otp: "123456" }).expect(400);
    const linked = await authed(api().post("/internal/care-contexts/link")).send({ ...body, otp: "000000" }).expect(201);
    expect(linked.body.status).toBe("linked");
    expect(linked.body.linked).toEqual([{ reference: "OPD-2026-0001", display: "OPD visit 14 Aug 2026 — General Medicine" }]);
    expect(linked.body.simulated.consent).toMatchObject({ purposeCode: "CAREMGT", hiTypes: ["Prescription"] });
    expect(linked.body.simulated.bundle).toMatchObject({ hiType: "Prescription", igVersion: "6.5" });

    const content = await authed(api().get(`/internal/bundles/${linked.body.simulated.bundle.transactionId}/content`)).expect(200);
    expect(content.body.bundle.resourceType).toBe("Bundle");
    expect(content.body.bundle.type).toBe("document");
    expect(content.body.bundle.entry[0].resource.resourceType).toBe("Composition");
    expect(content.body.bundle.entry.length).toBe(linked.body.simulated.bundle.entryCount);
  });

  it("validates request bodies with RFC 7807-style problems", async () => {
    const res = await authed(api().post("/internal/abha/link/init")).send({ method: "carrier-pigeon" }).expect(400);
    expect(res.body.code).toBe("validation_failed");
    expect(res.body.issues[0].path).toBe("method");
  });

  it("revoke is recorded as an outbound transaction", async () => {
    const res = await authed(api().post("/internal/consents/mock-consent-1/revoke")).send({ reason: "done", correlationId: "cid-9" }).expect(201);
    expect(res.body).toEqual({ status: "revoked", artefactId: "mock-consent-1" });
    expect(store.rows.some((r) => r.kind === "consents.revoke" && r.status === "completed" && r.correlationId === "cid-9")).toBe(true);
  });
});

describe("internal API without MOCK", () => {
  it("answers 501 rather than pretending to reach ABDM", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InternalController],
      providers: [
        { provide: TRANSACTION_STORE, useValue: new InMemoryTransactionStore() },
        { provide: MOCK_GATEWAY, useValue: null },
        { provide: GATEWAY_ENV, useValue: "sandbox" },
        { provide: INTERNAL_TOKEN, useValue: TOKEN },
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const res = await request(app.getHttpServer()).post("/internal/discover").set("x-abdm-internal-token", TOKEN).send({ abhaAddress: "a@sbx", abhaNumber: "91-1234-5678-9012" }).expect(501);
    expect(res.body.code).toBe("abdm_gateway_not_configured");
    await app.close();
  });
});
