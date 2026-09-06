import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";

/**
 * Gate 3 alert-quality dashboard (docs_v2/06 P9-4): per rule version, raised /
 * acknowledged / reviewed / dismissed-as-not-relevant, the two rates and the median
 * time to acknowledgement — behind the rules_view duty, and free of anything clinical.
 */
describe("Admin rules quality e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let profileId: string;
  let token: string;
  let userId: string;

  const PHONE = "+919000051188";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, admin_sessions, admin_users,
        safety_finding_actions, safety_findings, safety_evaluations,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;
    userId = verify.body.user.id;
    const profile = await request(app.getHttpServer())
      .post("/v1/profiles")
      .set("authorization", `Bearer ${token}`)
      .set("x-requested-with", "medpass")
      .send({ displayName: "Quality Test Patient", preferredLocale: "en", yearOfBirth: 1980 })
      .expect(201);
    profileId = profile.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAdminWithSession(email: string, duties: string[]): Promise<string[]> {
    const admin = await prisma.adminUser.create({ data: { email, passwordHash: hashPassword("test-password-123"), duties: duties as never } });
    const sessionToken = newOpaqueToken();
    await prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashSessionToken(sessionToken),
        refreshTokenHash: hashSessionToken(newOpaqueToken()),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return [`medpass_admin_session=${sessionToken}`];
  }

  async function finding(ruleKey: string, ruleVersion: string, evaluatedAt: Date, detail: Record<string, unknown> = {}) {
    const evaluation = await prisma.safetyEvaluation.create({
      data: { patientProfileId: profileId, trigger: "medication_added", appVersion: "test", inputSnapshot: {}, completedAt: evaluatedAt },
    });
    return prisma.safetyFinding.create({
      data: {
        evaluationId: evaluation.id,
        patientProfileId: profileId,
        category: "duplicate_ingredient",
        severity: "moderate",
        medicationIds: [],
        ruleKey,
        ruleVersion,
        sourceName: "own-normalization",
        explanationKey: "safety.explanation.duplicate_exact",
        detail: { ingredient: "Metformin", ...detail },
        evaluatedAt,
      },
    });
  }

  async function action(findingId: string, type: string, occurredAt: Date) {
    await prisma.safetyFindingAction.create({ data: { findingId, action: type as never, actorUserId: userId, occurredAt } });
  }

  it("without rules_view duty, the dashboard is forbidden (403)", async () => {
    const cookies = await createAdminWithSession("quality-noduty@test.com", ["operations_view"]);
    await request(app.getHttpServer()).get("/v1/admin/rules/quality").set("Cookie", cookies).expect(403);
  });

  it("rejects a window whose from is after to", async () => {
    const cookies = await createAdminWithSession("quality-window@test.com", ["rules_view"]);
    await request(app.getHttpServer())
      .get("/v1/admin/rules/quality?from=2026-09-10T00:00:00Z&to=2026-09-01T00:00:00Z")
      .set("Cookie", cookies)
      .expect(400);
  });

  it("aggregates per rule version: counts, rates, median time to acknowledgement — ids opaque, no clinical values", async () => {
    const cookies = await createAdminWithSession("quality-viewer@test.com", ["rules_view"]);
    const t0 = new Date("2026-08-01T10:00:00Z");
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

    // duplicate-ingredient-exact@1: four raised — two acknowledged (10 min, 30 min), one dismissed, one untouched.
    const a = await finding("duplicate-ingredient-exact", "1", t0);
    await action(a.id, "acknowledged", at(10));
    const b = await finding("duplicate-ingredient-exact", "1", t0);
    await action(b.id, "acknowledged", at(30));
    await action(b.id, "reviewed_with_professional", at(60));
    const c = await finding("duplicate-ingredient-exact", "1", t0);
    await action(c.id, "dismissed_not_relevant", at(5));
    await finding("duplicate-ingredient-exact", "1", t0);
    // A second version of the same rule is its own row.
    const d = await finding("duplicate-ingredient-exact", "2", at(1));
    await action(d.id, "acknowledged", at(2));
    // Out of the window: never counted.
    await finding("allergy-ingredient-match", "1", new Date("2026-06-01T00:00:00Z"));

    const res = await request(app.getHttpServer())
      .get("/v1/admin/rules/quality?from=2026-07-01T00:00:00Z&to=2026-09-01T00:00:00Z")
      .set("Cookie", cookies)
      .expect(200);

    expect(res.body.totals).toEqual({ raised: 5, acknowledged: 3, dismissedNotRelevant: 1 });
    expect(res.body.items).toHaveLength(2);
    const [v1, v2] = res.body.items;
    expect(v1).toEqual({
      ruleKey: "duplicate-ingredient-exact",
      ruleVersion: "1",
      raised: 4,
      acknowledged: 2,
      reviewedWithProfessional: 1,
      dismissedNotRelevant: 1,
      acknowledgementRate: 0.5,
      falsePositiveRate: 0.25,
      medianSecondsToAcknowledge: 20 * 60,
    });
    expect(v2).toMatchObject({ ruleVersion: "2", raised: 1, acknowledged: 1, acknowledgementRate: 1, falsePositiveRate: 0, medianSecondsToAcknowledge: 60 });

    // Nothing that identifies a person, a finding, or a medicine leaves the aggregate.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(profileId);
    expect(body).not.toContain(a.id);
    expect(body).not.toMatch(/metformin/i);
  });

  it("records 'not relevant to me' through the patient's own action endpoint and closes the finding", async () => {
    const f = await finding("schedule-conflict-missing", "1", new Date());
    const res = await request(app.getHttpServer())
      .post(`/v1/findings/${f.id}/actions`)
      .set("authorization", `Bearer ${token}`)
      .set("x-requested-with", "medpass")
      .set("x-profile-id", profileId)
      .send({ action: "dismissed_not_relevant", note: "I stopped this medicine last month" })
      .expect(201);
    expect(res.body.status).toBe("resolved");
    const actions = await prisma.safetyFindingAction.findMany({ where: { findingId: f.id } });
    expect(actions.map((x) => x.action)).toEqual(["dismissed_not_relevant"]);
  });
});
