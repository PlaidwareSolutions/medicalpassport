import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";

/** Admin operations e2e: the live summary reproduces the same aggregation as apps/cron's operational-report job. */
describe("Admin operations e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, admin_sessions, admin_users,
        background_jobs, dead_letter_jobs, backup_executions, restore_tests CASCADE
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

  it("without operations_view duty, summary is forbidden (403)", async () => {
    const cookies = await createAdminWithSession("ops-noduty@test.com", []);
    await request(app.getHttpServer()).get("/v1/admin/operations/summary").set("Cookie", cookies).expect(403);
  });

  it("reports real DLQ-outstanding and job-failure counts", async () => {
    const cookies = await createAdminWithSession("ops-viewer@test.com", ["operations_view"]);

    const job = await prisma.backgroundJob.create({
      data: { queue: "pdf_render", jobKey: `e2e-ops-${Date.now()}`, payload: {}, status: "failed", attempts: 3, completedAt: new Date(), errorDigest: "boom" },
    });
    await prisma.deadLetterJob.create({ data: { queue: "pdf_render", originalJobId: job.id, payload: {}, attempts: 3, errorDigest: "boom" } });
    await prisma.backupExecution.create({ data: { status: "succeeded", startedAt: new Date(), completedAt: new Date() } });

    const res = await request(app.getHttpServer()).get("/v1/admin/operations/summary").set("Cookie", cookies).expect(200);
    expect(res.body.windowHours).toBe(24);
    expect(res.body.jobFailuresInWindow).toBeGreaterThanOrEqual(1);
    expect(res.body.dlqOutstanding).toBeGreaterThanOrEqual(1);
    expect(res.body.latestBackup?.status).toBe("succeeded");
  });

  it("clamps windowHours to the documented max", async () => {
    const cookies = await createAdminWithSession("ops-clamp@test.com", ["operations_view"]);
    const res = await request(app.getHttpServer()).get("/v1/admin/operations/summary?windowHours=9999").set("Cookie", cookies).expect(200);
    expect(res.body.windowHours).toBe(168);
  });

  it("without operations_view duty, medication-stats is forbidden (403)", async () => {
    const cookies = await createAdminWithSession("medstats-noduty@test.com", []);
    await request(app.getHttpServer()).get("/v1/admin/operations/medication-stats").set("Cookie", cookies).expect(403);
  });

  it("reports de-identified, aggregate-only medicine counts — never a patient name or medicine name", async () => {
    const cookies = await createAdminWithSession("medstats-viewer@test.com", ["operations_view"]);

    const before = await request(app.getHttpServer())
      .get("/v1/admin/operations/medication-stats")
      .set("Cookie", cookies)
      .expect(200);

    // Seeded directly (not through the patient-facing HTTP flow, matching
    // this file's existing convention for BackgroundJob/DeadLetterJob) —
    // this admin endpoint's own correctness is what's under test, not the
    // medication-creation flow itself (already covered in api.e2e-spec.ts).
    const user = await prisma.user.create({
      data: { phoneDigest: `e2e-ops-medstats-${Date.now()}`, phoneCiphertext: "unused" },
    });
    const profile = await prisma.patientProfile.create({
      data: { ownerUserId: user.id, displayName: "E2E Ops Test Patient" },
    });
    const medication = await prisma.patientMedication.create({
      data: { patientProfileId: profile.id, enteredName: "E2E Ops Test Syrup", source: "manual", status: "current", criticalEscalation: true },
    });
    await prisma.medicationInstruction.create({
      data: { patientMedicationId: medication.id, doseQuantity: 5, doseUnit: "ml", frequencyCode: "OD", confirmedByUserId: user.id },
    });

    const after = await request(app.getHttpServer())
      .get("/v1/admin/operations/medication-stats")
      .set("Cookie", cookies)
      .expect(200);

    expect(after.body.totalMedicationsAllTime).toBe(before.body.totalMedicationsAllTime + 1);
    expect(after.body.totalActiveMedications).toBe(before.body.totalActiveMedications + 1);
    expect(after.body.byStatus.current).toBe((before.body.byStatus.current ?? 0) + 1);
    expect(after.body.bySource.manual).toBe((before.body.bySource.manual ?? 0) + 1);
    expect(after.body.byDoseUnit.ml).toBe((before.body.byDoseUnit.ml ?? 0) + 1);
    expect(after.body.criticalEscalationCount).toBe(before.body.criticalEscalationCount + 1);

    // The response must never leak the patient's name, the profile id, or the medicine's own name.
    const bodyText = JSON.stringify(after.body);
    expect(bodyText).not.toContain("E2E Ops Test Patient");
    expect(bodyText).not.toContain("E2E Ops Test Syrup");
    expect(bodyText).not.toContain(profile.id);
  });
});
