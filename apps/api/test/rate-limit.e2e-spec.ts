import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { RateLimitService } from "../src/common/rate-limit.service";

/**
 * Stage 11 follow-up e2e: application-level rate limiting (docs/14/18/26 —
 * "Cloudflare is never the only protection against account takeover or OTP
 * abuse", so this must stand alone). Covers both the underlying
 * Postgres-backed fixed-window counter (`RateLimitService`) directly, and
 * the real HTTP path through `RateLimitGuard` on an actual `@Public()`
 * route (public share access), which has no session to gate it otherwise.
 */
describe("Rate limiting e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let rateLimit: RateLimitService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
    rateLimit = moduleRef.get(RateLimitService);

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE rate_limit_buckets`);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("RateLimitService (Postgres-backed fixed window)", () => {
    it("allows requests under the limit and rejects once the limit is exceeded", async () => {
      const key = `unit-test:${crypto.randomUUID()}`;
      for (let i = 0; i < 3; i++) {
        const result = await rateLimit.checkAndIncrement(key, 3, 60);
        expect(result.allowed).toBe(true);
      }
      const fourth = await rateLimit.checkAndIncrement(key, 3, 60);
      expect(fourth.allowed).toBe(false);
      expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
      expect(fourth.retryAfterSeconds).toBeLessThanOrEqual(60);
    });

    it("gives independent budgets to different keys", async () => {
      const keyA = `unit-test:${crypto.randomUUID()}`;
      const keyB = `unit-test:${crypto.randomUUID()}`;
      await rateLimit.checkAndIncrement(keyA, 1, 60);
      const aSecond = await rateLimit.checkAndIncrement(keyA, 1, 60);
      const bFirst = await rateLimit.checkAndIncrement(keyB, 1, 60);
      expect(aSecond.allowed).toBe(false);
      expect(bFirst.allowed).toBe(true);
    });

    it("resets once a new window begins", async () => {
      const key = `unit-test:${crypto.randomUUID()}`;
      const first = await rateLimit.checkAndIncrement(key, 1, 1);
      const second = await rateLimit.checkAndIncrement(key, 1, 1);
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 1100));
      const afterWindow = await rateLimit.checkAndIncrement(key, 1, 1);
      expect(afterWindow.allowed).toBe(true);
    });

    it("never under-counts concurrent increments in the same window (atomic upsert)", async () => {
      const key = `unit-test:${crypto.randomUUID()}`;
      const results = await Promise.all(Array.from({ length: 20 }, () => rateLimit.checkAndIncrement(key, 1000, 60)));
      const bucket = await prisma.rateLimitBucket.findFirst({ where: { key } });
      expect(bucket?.count).toBe(20);
      expect(results.every((r) => r.allowed)).toBe(true);
    });
  });

  describe("RateLimitGuard on a real @Public() route (public share access)", () => {
    it("rejects the request once the per-IP budget is exceeded, with a Retry-After header", async () => {
      let sawRateLimited = false;
      let retryAfterHeader: string | undefined;

      // share_access is budgeted 30/60s; a bogus token 404s well before that
      // (the guard runs before the route handler resolves the token either way).
      for (let i = 0; i < 31; i++) {
        const res = await request(app.getHttpServer()).get("/v1/public/shares/not-a-real-token-rate-limit-test");
        if (res.status === 429) {
          sawRateLimited = true;
          retryAfterHeader = res.headers["retry-after"];
          break;
        }
        expect(res.status).toBe(404);
      }

      expect(sawRateLimited).toBe(true);
      expect(retryAfterHeader).toBeDefined();
      expect(Number(retryAfterHeader)).toBeGreaterThan(0);
    }, 30000);

    it("a different endpoint's budget is unaffected by another endpoint's exhausted budget", async () => {
      // share_access is now exhausted (previous test) — catalog_search has its own separate budget.
      const exhausted = await request(app.getHttpServer()).get("/v1/public/shares/still-exhausted-check");
      expect(exhausted.status).toBe(429);

      await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: "+919000005401" }).expect(202);
      const verify = await request(app.getHttpServer())
        .post("/v1/auth/otp/verify")
        .send({ phone: "+919000005401", code: process.env.OTP_DEV_FIXED_CODE ?? "000000", device: { kind: "browser" } })
        .expect(201);

      const search = await request(app.getHttpServer())
        .get("/v1/catalog/products?q=para")
        .set("authorization", `Bearer ${verify.body.token}`)
        .set("x-requested-with", "medpass");
      expect(search.status).toBe(200);
    });
  });
});
