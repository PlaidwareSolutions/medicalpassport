import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CallbacksController, GATEWAY_ENV, GATEWAY_JWT_VERIFIER } from "./callbacks.controller";
import { Hs256Verifier, signHs256 } from "./jwt";
import { InMemoryTransactionStore, TRANSACTION_STORE, digestOf } from "./transactions";

const SECRET = "callbacks-spec-secret-not-secret";

/**
 * docs_v2/08 §4: every callback verifies the gateway JWT, persists an AbdmTransaction (digest, not
 * body), enqueues, and answers 202. No database: the store is in memory.
 */
describe("ABDM callbacks", () => {
  let app: INestApplication;
  let store: InMemoryTransactionStore;

  beforeAll(async () => {
    store = new InMemoryTransactionStore();
    const moduleRef = await Test.createTestingModule({
      controllers: [CallbacksController],
      providers: [
        { provide: TRANSACTION_STORE, useValue: store },
        { provide: GATEWAY_JWT_VERIFIER, useValue: new Hs256Verifier(SECRET, { issuer: "abdm-gateway" }) },
        { provide: GATEWAY_ENV, useValue: "mock" },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const token = () => signHs256({ iss: "abdm-gateway", exp: Math.floor(Date.now() / 1000) + 300 }, SECRET);

  const ROUTES = [
    ["/v0.5/patients/on-find", "patients.on-find"],
    ["/v0.5/links/link/on-init", "links.link.on-init"],
    ["/v0.5/links/link/on-confirm", "links.link.on-confirm"],
    ["/v0.5/consents/hiu/notify", "consents.hiu.notify"],
    ["/v0.5/health-information/hiu/on-request", "health-information.hiu.on-request"],
    ["/v0.5/health-information/transfer", "health-information.transfer"],
  ] as const;

  it.each(ROUTES)("%s → 202, persists the transaction with a body digest and enqueues once", async (path, kind) => {
    const body = { requestId: `req-${kind}`, transactionId: `txn-${kind}`, timestamp: "2026-09-06T00:00:00Z", payload: { secret: "never stored" } };
    const res = await request(app.getHttpServer()).post(path).set("authorization", `Bearer ${token()}`).set("x-correlation-id", `cid-${kind}`).send(body).expect(202);
    expect(res.body).toMatchObject({ accepted: true, correlationId: `cid-${kind}` });

    const row = store.rows.find((r) => r.kind === kind)!;
    expect(row).toMatchObject({ direction: "inbound", status: "received", requestId: `req-${kind}`, transactionId: `txn-${kind}`, correlationId: `cid-${kind}`, gatewayEnv: "mock" });
    expect(row.requestDigest).toBe(digestOf(body));
    expect(JSON.stringify(row)).not.toContain("never stored");

    const job = store.jobs.find((j) => j.jobKey === `abdm:${kind}:req-${kind}`)!;
    expect(job).toMatchObject({ queue: "abdm_inbound_import", payload: { abdmTransactionId: row.id, kind, requestId: `req-${kind}` } });

    // Redelivery of the same requestId is idempotent on the queue.
    await request(app.getHttpServer()).post(path).set("authorization", `Bearer ${token()}`).send(body).expect(202);
    expect(store.jobs.filter((j) => j.jobKey === `abdm:${kind}:req-${kind}`)).toHaveLength(1);
  });

  it("rejects a missing, forged or expired gateway JWT with 401 and records nothing", async () => {
    const before = store.rows.length;
    await request(app.getHttpServer()).post("/v0.5/patients/on-find").send({ requestId: "r" }).expect(401);
    await request(app.getHttpServer()).post("/v0.5/patients/on-find").set("authorization", `Bearer ${signHs256({ iss: "abdm-gateway" }, "forged-secret-not-the-real-one")}`).send({ requestId: "r" }).expect(401);
    await request(app.getHttpServer()).post("/v0.5/patients/on-find").set("authorization", `Bearer ${signHs256({ iss: "abdm-gateway", exp: 1 }, SECRET)}`).send({ requestId: "r" }).expect(401);
    await request(app.getHttpServer()).post("/v0.5/patients/on-find").set("authorization", `Bearer ${signHs256({ iss: "not-the-gateway" }, SECRET)}`).send({ requestId: "r" }).expect(401);
    expect(store.rows).toHaveLength(before);
  });

  it("assigns a correlation id when the gateway sends none", async () => {
    const res = await request(app.getHttpServer()).post("/v0.5/consents/hiu/notify").set("authorization", `Bearer ${token()}`).send({ requestId: "no-cid" }).expect(202);
    expect(res.body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
