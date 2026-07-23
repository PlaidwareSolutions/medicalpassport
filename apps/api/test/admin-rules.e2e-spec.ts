import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";

/** Admin rules/findings review e2e: read-only rule versions + cross-profile findings. */
describe("Admin rules e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let profileId: string;

  const PHONE = "+919000051177";
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
    const profile = await request(app.getHttpServer())
      .post("/v1/profiles")
      .set("authorization", `Bearer ${verify.body.token}`)
      .set("x-requested-with", "medpass")
      .send({ displayName: "Rules Test Patient", preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

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

  it("without rules_view duty, rules/findings are forbidden (403)", async () => {
    const cookies = await createAdminWithSession("rules-noduty@test.com", []);
    await request(app.getHttpServer()).get("/v1/admin/rules").set("Cookie", cookies).expect(403);
    await request(app.getHttpServer()).get("/v1/admin/findings").set("Cookie", cookies).expect(403);
  });

  it("lists the current hardcoded rule keys/versions", async () => {
    const cookies = await createAdminWithSession("rules-viewer@test.com", ["rules_view"]);
    const res = await request(app.getHttpServer()).get("/v1/admin/rules").set("Cookie", cookies).expect(200);
    expect(res.body.items.some((r: { name: string; key: string }) => r.name === "exactDuplicate" && r.key === "duplicate-ingredient-exact")).toBe(true);
  });

  it("lists cross-profile findings with full traceability and audits the view", async () => {
    const cookies = await createAdminWithSession("rules-findings@test.com", ["rules_view"]);

    const evaluation = await prisma.safetyEvaluation.create({
      data: { patientProfileId: profileId, trigger: "medication_added", appVersion: "test", inputSnapshot: {}, completedAt: new Date() },
    });
    const finding = await prisma.safetyFinding.create({
      data: {
        evaluationId: evaluation.id,
        patientProfileId: profileId,
        category: "drug_allergy",
        severity: "high",
        medicationIds: [],
        ruleKey: "allergy-ingredient-match",
        ruleVersion: "1",
        sourceName: "own-normalization",
        explanationKey: "safety.explanation.allergy_match",
        detail: { ingredient: "Penicillin" },
      },
    });

    const list = await request(app.getHttpServer())
      .get(`/v1/admin/findings?patientProfileId=${profileId}&severity=high`)
      .set("Cookie", cookies)
      .expect(200);
    expect(list.body.items.some((f: { id: string }) => f.id === finding.id)).toBe(true);

    const detail = await request(app.getHttpServer()).get(`/v1/admin/findings/${finding.id}`).set("Cookie", cookies).expect(200);
    expect(detail.body.evaluation.id).toBe(evaluation.id);
    expect(detail.body.evaluation.appVersion).toBe("test");
    expect(detail.body.actions).toEqual([]);

    const auditEvents = await prisma.auditEvent.findMany({ where: { action: "admin.findings_viewed" } });
    expect(auditEvents.length).toBeGreaterThanOrEqual(2); // list + detail
  });
});
