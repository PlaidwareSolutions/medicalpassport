import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, hashSessionToken, newOpaqueToken } from "../src/common/crypto";
import { emitProductEvent, ProductEventsService } from "../src/modules/product-events/product-events.service";

/**
 * Product metrics (docs_v2/06 P1-7, docs_v2/14 §6): real patient actions
 * land as PHI-free rows in `product_events` via the buffered emitter, the
 * admin aggregate counts them per event per day under `operations_view`,
 * and a PHI-looking property is refused before it can be stored.
 */
describe("Product events e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: ProductEventsService;

  const PHONE = "+919000000801";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
    events = moduleRef.get(ProductEventsService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, product_events, admin_sessions, admin_users, offline_mutations,
        observations, dose_events, scheduled_doses, medication_schedules, medication_changes, medication_instructions,
        patient_medications, practitioners, patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
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

  let token: string;
  let userId: string;
  let profileId: string;

  it("a sign-in, a profile, a medicine, a dose and a measurement each leave one PHI-free row", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" }, locale: "hi" })
      .expect(201);
    token = verify.body.token;
    userId = (await prisma.user.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).id;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Metrics Test Patient", yearOfBirth: 1975, preferredLocale: "hi" })
      .expect(201);
    profileId = profile.body.id;

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .set("idempotency-key", randomUUID())
      .send({ enteredName: "Metrics Test Medicine", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(201);

    const timeline = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/timeline")).expect(200);
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/doses/${timeline.body.items[0].scheduledDoseId}/events`))
      .send({ action: "taken" })
      .expect(201);

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/observations"))
      .send({ concept: "blood_glucose", valueNumeric: 118, context: "fasting", measuredAt: new Date().toISOString() })
      .expect(201);

    await events.flush();
    const rows = await prisma.productEvent.findMany({ orderBy: { occurredAt: "asc" } });
    const names = rows.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "acquisition.sign_in",
        "acquisition.profile_created",
        "activation.medicine_added",
        "engagement.dose_recorded",
        "engagement.measurement_recorded",
      ]),
    );

    const measurement = rows.find((r) => r.name === "engagement.measurement_recorded")!;
    expect(measurement.properties).toEqual({ concept: "blood_glucose", hasContext: true });
    expect(measurement.locale).toBe("hi");
    expect(measurement.clientKind).toBe("pwa");
    // Digests, never ids: nothing in the row equals the real profile or user id.
    expect(measurement.profileDigest).toBe(events.digest(profileId));
    expect(measurement.userDigest).toBe(events.digest(userId));
    for (const row of rows) {
      const serialised = JSON.stringify(row);
      expect(serialised).not.toContain(profileId);
      expect(serialised).not.toContain(userId);
      expect(serialised).not.toContain("Metrics Test");
      expect(serialised).not.toContain(PHONE);
    }

    const medicine = rows.find((r) => r.name === "activation.medicine_added")!;
    expect(medicine.properties).toEqual({ via: "manual" });
    const dose = rows.find((r) => r.name === "engagement.dose_recorded")!;
    expect(dose.properties).toEqual({ action: "taken", offline: false });
  });

  it("a PHI-looking or undeclared property is rejected: nothing stored, the request never sees an error", async () => {
    const before = await prisma.productEvent.count();
    expect(emitProductEvent({ name: "engagement.dose_recorded", profileId, properties: { action: "taken", offline: false, medicineName: "Metformin" } })).toBe(false);
    expect(emitProductEvent({ name: "engagement.dose_recorded", profileId, properties: { action: "taken", offline: false, phone: PHONE } })).toBe(false);
    expect(emitProductEvent({ name: "engagement.dose_recorded", profileId, properties: { action: "taken", offline: false, extra: 1 } })).toBe(false);
    expect(emitProductEvent({ name: "nope.nothing" as never })).toBe(false);
    await events.flush();
    expect(await prisma.productEvent.count()).toBe(before);
    expect(events.stats().rejected).toBe(4);
  });

  it("the admin aggregate counts per event per day under operations_view, and is forbidden without it", async () => {
    const noDuty = await createAdminWithSession("metrics-noduty@test.com", []);
    await request(app.getHttpServer()).get("/v1/admin/metrics/product").set("Cookie", noDuty).expect(403);

    const cookies = await createAdminWithSession("metrics-viewer@test.com", ["operations_view"]);
    const res = await request(app.getHttpServer()).get("/v1/admin/metrics/product").set("Cookie", cookies).expect(200);
    expect(res.body.timezone).toBe("Asia/Kolkata");
    expect(res.body.totals["engagement.measurement_recorded"]).toBe(1);
    expect(res.body.totals["activation.medicine_added"]).toBe(1);
    expect(res.body.totals["acquisition.sign_in"]).toBe(1);
    expect(res.body.days).toHaveLength(1);
    expect(res.body.days[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.days[0].counts["engagement.dose_recorded"]).toBe(1);
    // Aggregate only: no digest, no id, no property value anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain(events.digest(profileId));
    expect(JSON.stringify(res.body)).not.toContain(profileId);

    const empty = await request(app.getHttpServer())
      .get("/v1/admin/metrics/product?from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z")
      .set("Cookie", cookies)
      .expect(200);
    expect(empty.body.days).toEqual([]);
    expect(empty.body.totals).toEqual({});

    await request(app.getHttpServer())
      .get("/v1/admin/metrics/product?from=2020-01-01T00:00:00.000Z&to=2021-01-01T00:00:00.000Z")
      .set("Cookie", cookies)
      .expect(400);
  });
});
