import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { SECURITY_HEADERS } from "../src/common/security-headers";

/**
 * Ticket 0.19: the origin security headers are bound from AppModule, so this
 * harness (which never runs main.ts) sees exactly what production serves.
 * Every header the module sets must be on every response — public,
 * authenticated, rejected by a guard, and not-found alike.
 */
describe("Security headers e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  const PHONE = "+919000000771";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE rate_limit_buckets, sessions, user_devices, otp_attempts, patient_profiles, users CASCADE`);

    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  const headerNames = Object.keys(SECURITY_HEADERS);

  function expectAllHeaders(res: request.Response): void {
    for (const name of headerNames) expect(res.headers[name]).toBe(SECURITY_HEADERS[name]);
  }

  it("sets every header the module defines (the set is what docs_v2/11 §9 promises)", () => {
    expect(headerNames.sort()).toEqual(
      [
        "strict-transport-security",
        "x-content-type-options",
        "referrer-policy",
        "x-frame-options",
        "content-security-policy",
        "permissions-policy",
        "cross-origin-opener-policy",
        "cross-origin-resource-policy",
      ].sort(),
    );
    expect(SECURITY_HEADERS["content-security-policy"]).toContain("default-src 'none'");
    expect(SECURITY_HEADERS["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(SECURITY_HEADERS["x-frame-options"]).toBe("DENY");
  });

  it("on a public route", async () => {
    const res = await request(app.getHttpServer()).get("/v1/meta/version").expect(200);
    expectAllHeaders(res);
  });

  it("on a health route outside the global prefix", async () => {
    const res = await request(app.getHttpServer()).get("/healthz").expect(200);
    expectAllHeaders(res);
  });

  it("on an authenticated route", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/profiles")
      .set("authorization", `Bearer ${token}`)
      .set("x-requested-with", "medpass")
      .expect(200);
    expectAllHeaders(res);
  });

  it("on a guard rejection and on a 404 outside the prefix", async () => {
    const unauthenticated = await request(app.getHttpServer()).get("/v1/profiles").expect(401);
    expectAllHeaders(unauthenticated);
    const missing = await request(app.getHttpServer()).get("/definitely-not-a-route").expect(404);
    expectAllHeaders(missing);
  });

  it("/v1/meta/openapi.json still serves the pinned document, with the headers and its own cache policy", async () => {
    const res = await request(app.getHttpServer()).get("/v1/meta/openapi.json").expect(200);
    expectAllHeaders(res);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers.etag).toMatch(/^W\//);
    expect(res.body.openapi).toMatch(/^3\.1/);
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(100);
  });
});
