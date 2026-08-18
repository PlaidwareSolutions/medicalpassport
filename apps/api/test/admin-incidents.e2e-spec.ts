import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";

/** Admin incidents e2e: DLQ list/replay, admin share revoke. */
describe("Admin incidents e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000041199";
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
        background_jobs, dead_letter_jobs, share_access_events, share_links, share_packages,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
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

  it("without incident_response duty, DLQ list/replay/share-revoke are all forbidden (403)", async () => {
    const cookies = await createAdminWithSession("incidents-noduty@test.com", []);
    await request(app.getHttpServer()).get("/v1/admin/incidents/dlq").set("Cookie", cookies).expect(403);
    await request(app.getHttpServer()).post("/v1/admin/jobs/00000000-0000-0000-0000-000000000000/replay").set("Cookie", cookies).set("x-requested-with", "medpass").expect(403);
    await request(app.getHttpServer()).post("/v1/admin/incidents/shares/00000000-0000-0000-0000-000000000000/revoke").set("Cookie", cookies).set("x-requested-with", "medpass").expect(403);
  });

  it("replays a dead-letter job, resetting the original BackgroundJob to queued/attempts:0; double-replay 409", async () => {
    const cookies = await createAdminWithSession("incidents-replay@test.com", ["incident_response"]);

    const job = await prisma.backgroundJob.create({
      data: { queue: "ocr_extraction", jobKey: `e2e-replay-${Date.now()}`, payload: {}, status: "failed", attempts: 3, errorDigest: "boom" },
    });
    const dlq = await prisma.deadLetterJob.create({
      data: { queue: "ocr_extraction", originalJobId: job.id, payload: {}, attempts: 3, errorDigest: "boom" },
    });

    const list = await request(app.getHttpServer()).get("/v1/admin/incidents/dlq").set("Cookie", cookies).expect(200);
    expect(list.body.items.some((i: { id: string }) => i.id === dlq.id)).toBe(true);

    await request(app.getHttpServer())
      .post(`/v1/admin/jobs/${dlq.id}/replay`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .expect(201);

    const resetJob = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(resetJob.status).toBe("queued");
    expect(resetJob.attempts).toBe(0);
    expect(resetJob.errorDigest).toBeNull();

    await request(app.getHttpServer())
      .post(`/v1/admin/jobs/${dlq.id}/replay`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .expect(409);

    const auditEvent = await prisma.auditEvent.findFirst({ where: { action: "admin.job_replayed", entityId: dlq.id } });
    expect(auditEvent).not.toBeNull();
  });

  it("revokes a share the admin has no patient-side relationship to", async () => {
    const cookies = await createAdminWithSession("incidents-revoke@test.com", ["incident_response"]);

    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    const token = verify.body.token;

    const profile = await request(app.getHttpServer())
      .post("/v1/profiles")
      .set("authorization", `Bearer ${token}`)
      .set("x-requested-with", "medpass")
      .send({ displayName: "Incident Test Patient", preferredLocale: "en", yearOfBirth: 1980 })
      .expect(201);
    const profileId = profile.body.id;

    const share = await request(app.getHttpServer())
      .post("/v1/profiles/current/shares")
      .set("authorization", `Bearer ${token}`)
      .set("x-requested-with", "medpass")
      .set("x-profile-id", profileId)
      .send({ sections: {}, expiresInHours: 24, kind: "link" })
      .expect(201);
    const shareLinkId = share.body.id;

    await request(app.getHttpServer())
      .post(`/v1/admin/incidents/shares/${shareLinkId}/revoke`)
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ reason: "reported abuse" })
      .expect(201);

    const link = await prisma.shareLink.findUniqueOrThrow({ where: { id: shareLinkId } });
    expect(link.revokedAt).not.toBeNull();

    const auditEvent = await prisma.auditEvent.findFirst({ where: { action: "admin.share_revoked", entityId: shareLinkId } });
    expect(auditEvent?.context).toMatchObject({ reason: "reported abuse" });
  });
});
