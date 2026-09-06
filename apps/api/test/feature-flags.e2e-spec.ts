import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { FeatureFlagService } from "../src/modules/meta/feature-flag.service";

/**
 * `GET meta/flags` served from FeatureFlag rows with per-profile evaluation
 * (docs_v2/05 §14): static defaults when no row exists, allowlist,
 * percentage rollout by stable hash, environment scoping, and a row
 * overriding a static key.
 */
describe("Feature flags e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();
  const profileA = randomUUID();
  const profileB = randomUUID();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE feature_flags CASCADE`);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it("with no rows, serves exactly the static env defaults", async () => {
    const res = await request(server()).get("/v1/meta/flags").expect(200);
    expect(res.body).toEqual({ prescriptionUpload: false, safetyFindings: false, sharing: false, aiExplanations: false });
  });

  it("an allowlisted profile sees the flag on; everyone else sees the default", async () => {
    await prisma.featureFlag.create({ data: { key: "testDueSchedules", defaultOn: false, rolloutPercent: 0, allowProfileIds: [profileA] } });
    const a = await request(server()).get("/v1/meta/flags").set("x-profile-id", profileA).expect(200);
    const b = await request(server()).get("/v1/meta/flags").set("x-profile-id", profileB).expect(200);
    const none = await request(server()).get("/v1/meta/flags").expect(200);
    expect(a.body.testDueSchedules).toBe(true);
    expect(b.body.testDueSchedules).toBe(false);
    expect(none.body.testDueSchedules).toBe(false);
    // The four static keys are always present alongside.
    expect(Object.keys(a.body).sort()).toEqual(["aiExplanations", "prescriptionUpload", "safetyFindings", "sharing", "testDueSchedules"]);
  });

  it("a percentage rollout buckets profiles by a stable hash — deterministic, and 100% means every profile", async () => {
    await prisma.featureFlag.create({ data: { key: "measurementReminders", defaultOn: false, rolloutPercent: 100, allowProfileIds: [] } });
    const withProfile = await request(server()).get("/v1/meta/flags").set("x-profile-id", profileB).expect(200);
    expect(withProfile.body.measurementReminders).toBe(true);
    // No profile → nothing to bucket → the default.
    const none = await request(server()).get("/v1/meta/flags").expect(200);
    expect(none.body.measurementReminders).toBe(false);

    const bucket = FeatureFlagService.bucket("measurementReminders", profileB);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(100);
    expect(FeatureFlagService.bucket("measurementReminders", profileB)).toBe(bucket);
    // The boundary is exact: a rollout equal to the bucket excludes the profile, one above includes it.
    const row = { key: "measurementReminders", defaultOn: false, allowProfileIds: [] as string[] };
    expect(FeatureFlagService.evaluateRow({ ...row, rolloutPercent: bucket }, profileB)).toBe(false);
    expect(FeatureFlagService.evaluateRow({ ...row, rolloutPercent: bucket + 1 }, profileB)).toBe(true);
  });

  it("a row overrides a static key; a row scoped to another environment is ignored", async () => {
    await prisma.featureFlag.create({ data: { key: "sharing", defaultOn: true, rolloutPercent: 0, allowProfileIds: [] } });
    await prisma.featureFlag.create({ data: { key: "aiExplanations", defaultOn: true, rolloutPercent: 0, allowProfileIds: [], environment: "production" } });
    const res = await request(server()).get("/v1/meta/flags").expect(200);
    expect(res.body.sharing).toBe(true);
    expect(res.body.aiExplanations).toBe(false);
  });

  it("ignores a malformed x-profile-id rather than failing", async () => {
    const res = await request(server()).get("/v1/meta/flags").set("x-profile-id", "not-a-uuid").expect(200);
    expect(res.body.testDueSchedules).toBe(false);
  });
});
