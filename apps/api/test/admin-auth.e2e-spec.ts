import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import * as OTPAuth from "otpauth";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword } from "../src/common/crypto";

/**
 * Admin auth e2e (docs/18): password + mandatory TOTP MFA, entirely separate
 * from patient OTP auth. Real AppModule, real Postgres, real TOTP codes
 * generated with the same `otpauth` library the API uses.
 */
describe("Admin auth e2e", () => {
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
        sessions, user_devices, otp_attempts, users CASCADE
    `);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAdmin(email: string, password: string, duties: string[] = ["super_admin"]) {
    return prisma.adminUser.create({
      data: { email, passwordHash: hashPassword(password), duties: duties as never },
    });
  }

  function totpCodeFor(secretBase32: string): string {
    const totp = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretBase32) });
    return totp.generate();
  }

  async function loginAndEnroll(email: string, password: string) {
    await createAdmin(email, password);
    const login = await request(app.getHttpServer())
      .post("/v1/admin/auth/login")
      .send({ email, password })
      .expect(201);
    expect(login.body.status).toBe("mfa_enrollment_required");
    const cookies = login.headers["set-cookie"] as unknown as string[];

    const enroll = await request(app.getHttpServer())
      .post("/v1/admin/auth/mfa/enroll")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .expect(201);
    const { secretBase32 } = enroll.body;

    await request(app.getHttpServer())
      .post("/v1/admin/auth/mfa/enroll/confirm")
      .set("Cookie", cookies)
      .set("x-requested-with", "medpass")
      .send({ code: totpCodeFor(secretBase32) })
      .expect(201);

    return { cookies, secretBase32 };
  }

  it("rejects login with a wrong password", async () => {
    await createAdmin("wrongpass@test.com", "correct-horse-battery-staple");
    await request(app.getHttpServer())
      .post("/v1/admin/auth/login")
      .send({ email: "wrongpass@test.com", password: "not-the-password" })
      .expect(401);
  });

  it("full round trip: login (mfa_enrollment_required) -> enroll -> confirm -> me", async () => {
    const { cookies } = await loginAndEnroll("roundtrip@test.com", "correct-horse-battery-staple");

    const me = await request(app.getHttpServer())
      .get("/v1/admin/auth/me")
      .set("Cookie", cookies)
      .expect(200);
    expect(me.body.email).toBe("roundtrip@test.com");
    expect(me.body.duties).toEqual(["super_admin"]);
  });

  it("a fully-enrolled admin logs in again with mfa_required, then verifies with a fresh TOTP code", async () => {
    const { secretBase32 } = await loginAndEnroll("relogin@test.com", "correct-horse-battery-staple");

    const login2 = await request(app.getHttpServer())
      .post("/v1/admin/auth/login")
      .send({ email: "relogin@test.com", password: "correct-horse-battery-staple" })
      .expect(201);
    expect(login2.body.status).toBe("mfa_required");
    const cookies2 = login2.headers["set-cookie"] as unknown as string[];

    await request(app.getHttpServer())
      .post("/v1/admin/auth/mfa/verify")
      .set("Cookie", cookies2)
      .set("x-requested-with", "medpass")
      .send({ code: totpCodeFor(secretBase32) })
      .expect(201);

    const me = await request(app.getHttpServer()).get("/v1/admin/auth/me").set("Cookie", cookies2).expect(200);
    expect(me.body.email).toBe("relogin@test.com");
  });

  it("rejects a wrong TOTP code during verify", async () => {
    await loginAndEnroll("wrongtotp@test.com", "correct-horse-battery-staple");
    const login2 = await request(app.getHttpServer())
      .post("/v1/admin/auth/login")
      .send({ email: "wrongtotp@test.com", password: "correct-horse-battery-staple" })
      .expect(201);
    const cookies2 = login2.headers["set-cookie"] as unknown as string[];

    await request(app.getHttpServer())
      .post("/v1/admin/auth/mfa/verify")
      .set("Cookie", cookies2)
      .set("x-requested-with", "medpass")
      .send({ code: "000000" })
      .expect(401);
  });

  it("locks the account after 5 failed password attempts (423)", async () => {
    // Fresh IP-scoped budget so this test's 6 login attempts aren't affected
    // by whatever earlier tests in this file already used.
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE rate_limit_buckets`);
    await createAdmin("lockout@test.com", "correct-horse-battery-staple");
    for (let i = 0; i < 4; i++) {
      await request(app.getHttpServer())
        .post("/v1/admin/auth/login")
        .send({ email: "lockout@test.com", password: "wrong" })
        .expect(401);
    }
    // 5th failure trips the lock.
    await request(app.getHttpServer())
      .post("/v1/admin/auth/login")
      .send({ email: "lockout@test.com", password: "wrong" })
      .expect(401);
    // Even the correct password is now rejected while locked.
    await request(app.getHttpServer())
      .post("/v1/admin/auth/login")
      .send({ email: "lockout@test.com", password: "correct-horse-battery-staple" })
      .expect(423);
  });

  it("session refresh and revoke", async () => {
    const { cookies } = await loginAndEnroll("refresh@test.com", "correct-horse-battery-staple");

    const refreshed = await request(app.getHttpServer())
      .post("/v1/admin/auth/refresh")
      .set("Cookie", cookies)
      .expect(201);
    expect(refreshed.body.status).toBe("ready");
    const newCookies = refreshed.headers["set-cookie"] as unknown as string[];

    const sessions = await request(app.getHttpServer()).get("/v1/admin/auth/sessions").set("Cookie", newCookies).expect(200);
    expect(sessions.body.items.length).toBeGreaterThan(0);
    const currentSessionId = sessions.body.items.find((s: { current: boolean }) => s.current).id;

    await request(app.getHttpServer())
      .delete(`/v1/admin/auth/sessions/${currentSessionId}`)
      .set("Cookie", newCookies)
      .set("x-requested-with", "medpass")
      .expect(204);

    await request(app.getHttpServer()).get("/v1/admin/auth/me").set("Cookie", newCookies).expect(401);
  });

  it("a patient session cannot access admin routes, and an admin session cannot access patient routes", async () => {
    const { cookies: adminCookies } = await loginAndEnroll("crosscheck@test.com", "correct-horse-battery-staple");

    // Patient sign-in (real OTP flow) for the cross-check.
    const phone = "+919000012399";
    const code = process.env.OTP_DEV_FIXED_CODE ?? "000000";
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code, device: { kind: "browser" } })
      .expect(201);
    const patientToken = verify.body.token;

    await request(app.getHttpServer())
      .get("/v1/admin/auth/me")
      .set("authorization", `Bearer ${patientToken}`)
      .set("x-requested-with", "medpass")
      .expect(401);

    await request(app.getHttpServer()).get("/v1/auth/devices").set("Cookie", adminCookies).expect(401);
  });
});
