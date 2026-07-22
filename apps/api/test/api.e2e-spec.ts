import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * End-to-end flow against a real PostgreSQL (DATABASE_URL):
 * OTP → session → profile → medication CRUD → caregiver grant/use/revoke →
 * idempotency, rowVersion conflicts, OTP limits, audit rows.
 */
describe("API e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000001";
  const PHONE_B = "+919000000002";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // Reset PHI tables so the suite is rerunnable (test databases only —
    // rate-limit state like otp_attempts persists across runs by design).
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, offline_mutations, medication_changes,
        medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signIn(phone: string): Promise<{ token: string }> {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const res = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser", label: "jest" } })
      .expect(201);
    expect(res.body.token).toBeTruthy();
    return { token: res.body.token };
  }

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  let tokenA: string;
  let tokenB: string;
  let profileA: string;
  let medicationId: string;
  let medicationRowVersion: number;

  it("serves health endpoints without auth", async () => {
    await request(app.getHttpServer()).get("/healthz").expect(200);
    const ready = await request(app.getHttpServer()).get("/readyz").expect(200);
    expect(ready.body.checks.postgres).toBe("ok");
  });

  it("exposes the configured OTP transport, unauthenticated, so the PWA can show accurate delivery wording", async () => {
    const res = await request(app.getHttpServer()).get("/v1/auth/otp-transport").expect(200);
    expect(res.body.transport).toBe(process.env.OTP_TRANSPORT ?? "log");
  });

  it("rejects unauthenticated PHI access and never publicly caches", async () => {
    const res = await request(app.getHttpServer()).get("/v1/profiles").expect(401);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.code).toBe("unauthenticated");
    expect(res.headers["x-correlation-id"]).toBeTruthy();
  });

  it("signs in with OTP (enumeration-safe request, fixed dev code)", async () => {
    ({ token: tokenA } = await signIn(PHONE_A));
  });

  it("rejects a wrong OTP and locks after repeated attempts", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE_B }).expect(202);
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post("/v1/auth/otp/verify")
        .send({ phone: PHONE_B, code: "999999", device: { kind: "browser" } });
      expect([400, 423]).toContain(res.status);
    }
    // Attempts exhausted: even the right code is refused now.
    const locked = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE_B, code: CODE, device: { kind: "browser" } });
    expect([400, 423]).toContain(locked.status);
  });

  it("enforces the OTP resend cooldown", async () => {
    const res = await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE_B });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("otp_resend_limit");
  });

  it("creates a patient profile with a baseline consent and audit trail", async () => {
    const res = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Test Patient", yearOfBirth: 1958, preferredLocale: "te" })
      .expect(201);
    profileA = res.body.id;

    const consents = await prisma.consent.findMany({ where: { patientProfileId: profileA } });
    expect(consents.some((c) => c.type === "data_processing" && c.status === "active")).toBe(true);

    const audits = await prisma.auditEvent.findMany({ where: { patientProfileId: profileA } });
    expect(audits.some((a) => a.action === "profile.created")).toBe(true);
  });

  it("searches the seeded catalog", async () => {
    const res = await auth(tokenA)(request(app.getHttpServer()).get("/v1/catalog/products?q=metf")).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].ingredients[0].name).toBe("Metformin");
  });

  it("creates a medication from the catalog with an idempotency key", async () => {
    const search = await auth(tokenA)(request(app.getHttpServer()).get("/v1/catalog/products?q=Glycomet")).expect(200);
    const productId = search.body.items[0].id;
    const idempotencyKey = "11111111-1111-4111-8111-111111111111";
    const body = {
      productId,
      source: "search",
      patientReason: "Sugar control",
      prescriberName: "Dr. Rao",
      instruction: {
        doseQuantity: 1,
        doseUnit: "tablet",
        frequencyCode: "PATTERN",
        pattern: "1-0-1",
        foodInstruction: "after",
      },
    };

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .set("idempotency-key", idempotencyKey)
      .send(body)
      .expect(201);
    medicationId = res.body.id;
    medicationRowVersion = res.body.rowVersion;
    expect(res.body.normalizationStatus).toBe("confirmed");
    expect(res.body.instruction.pattern).toBe("1-0-1");
    expect(res.body.patientReason).toBe("Sugar control");

    // Exact replay returns the same medication, not a duplicate.
    const replay = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .set("idempotency-key", idempotencyKey)
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(medicationId);
    const count = await prisma.patientMedication.count({ where: { patientProfileId: profileA, deletedAt: null } });
    expect(count).toBe(1);

    // Same key + different content is rejected.
    const mismatch = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .set("idempotency-key", idempotencyKey)
      .send({ ...body, patientReason: "Different" });
    expect(mismatch.status).toBe(409);
  });

  it("rejects ambiguous SOS + pattern combinations (never silently interpret)", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Painkiller",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "SOS", pattern: "1-0-1" },
      })
      .expect(400);
    expect(res.body.code).toBe("validation_failed");
  });

  it("enforces optimistic concurrency on medication updates", async () => {
    const stale = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medicationRowVersion + 99, patientReason: "Stale write" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("conflict_row_version");

    const ok = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medicationRowVersion, patientReason: "Updated reason" })
      .expect(200);
    medicationRowVersion = ok.body.rowVersion;
  });

  it("validates status transitions", async () => {
    const bad = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/medications/${medicationId}/status`))
      .send({ rowVersion: medicationRowVersion, status: "current" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("invalid_status_transition");

    const ok = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/medications/${medicationId}/status`))
      .send({ rowVersion: medicationRowVersion, status: "paused", reason: "Doctor said pause before surgery" })
      .expect(201);
    medicationRowVersion = ok.body.rowVersion;
    expect(ok.body.status).toBe("paused");
  });

  it("grants caregiver access, enforces scopes server-side, and revokes immediately", async () => {
    // Re-sign B: clear OTP throttle state left by the lockout/cooldown tests
    // (equivalent to waiting out the resend cooldown).
    await prisma.otpAttempt.deleteMany({});
    ({ token: tokenB } = await signIn(PHONE_B));

    // A invites B with view-only scope.
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);

    // B sees and accepts the invitation — the offered scopes must be visible
    // before accepting (informed consent, docs/23 E3.2), not accepted blind.
    const invitations = await auth(tokenB)(request(app.getHttpServer()).get("/v1/caregivers/invitations")).expect(200);
    const invitationSeen = invitations.body.items.find((i: { id: string }) => i.id === invite.body.id);
    expect(invitationSeen).toBeTruthy();
    expect(invitationSeen.scopes).toEqual(["view_medications"]);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept"))
      .send({ invitationId: invite.body.id })
      .expect(201);

    // B can view but not edit — enforcement is server-side.
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/medications")).expect(200);
    const denied = await auth(tokenB, profileA)(
      request(app.getHttpServer()).post("/v1/profiles/current/medications"),
    ).send({
      enteredName: "Not allowed",
      source: "manual",
      instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("caregiver_scope_missing");

    // Caregiver reads are audited.
    const audits = await prisma.auditEvent.findMany({
      where: { patientProfileId: profileA, action: "caregiver.access_used" },
    });
    expect(audits.length).toBeGreaterThan(0);

    // A can see B's access history — patient-visible access log (docs/23 E3.3).
    const accessLog = await auth(tokenA, profileA)(
      request(app.getHttpServer()).get(`/v1/caregivers/${invite.body.id}/accesses`),
    ).expect(200);
    expect(accessLog.body.items.length).toBeGreaterThan(0);
    expect(accessLog.body.items[0].accessedAt).toBeTruthy();

    // A revokes; B's next request fails immediately.
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/caregivers/${invite.body.id}`)).expect(204);
    const afterRevoke = await auth(tokenB, profileA)(
      request(app.getHttpServer()).get("/v1/profiles/current/medications"),
    );
    expect(afterRevoke.status).toBe(403);
  });

  it("keeps an append-only medication change history", async () => {
    const res = await auth(tokenA, profileA)(
      request(app.getHttpServer()).get(`/v1/medications/${medicationId}/history`),
    ).expect(200);
    const changes = res.body.items.map((c: { change: string }) => c.change);
    expect(changes).toEqual(expect.arrayContaining(["created", "updated", "status_changed"]));
  });

  it("revoked sessions are rejected on the next request", async () => {
    const sessions = await auth(tokenA)(request(app.getHttpServer()).get("/v1/auth/sessions")).expect(200);
    const current = sessions.body.items.find((s: { current: boolean }) => s.current);
    await auth(tokenA)(request(app.getHttpServer()).delete(`/v1/auth/sessions/${current.id}`)).expect(204);
    const res = await auth(tokenA)(request(app.getHttpServer()).get("/v1/profiles"));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("session_revoked");
  });
});
