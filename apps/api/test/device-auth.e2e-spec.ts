import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Trusted-device login (docs/24 ADR-14): once a device completes OTP with
 * "remember this device" checked, POST /auth/device-login logs it back in
 * with just a phone number, no OTP — until Sign out or a remote device
 * revoke. Cookie-driven end to end (medpass_session/medpass_refresh/
 * medpass_device_trust), so this suite drives real Set-Cookie headers
 * through supertest rather than bearer tokens, mirroring
 * admin-auth.e2e-spec.ts's pattern (the only other cookie-based auth suite).
 */
describe("Trusted-device login e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000871";
  const PHONE_B = "+919000000872";
  const PHONE_C = "+919000000873";
  const PHONE_D = "+919000000874";
  const PHONE_E = "+919000000875";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, sessions, user_devices,
        otp_attempts, patient_profiles, users CASCADE
    `);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  function cookiesOf(res: request.Response): string[] {
    return (res.headers["set-cookie"] as unknown as string[]) ?? [];
  }
  function findCookie(cookies: string[], name: string): string | undefined {
    return cookies.find((c) => c.startsWith(`${name}=`));
  }

  async function signInRemembered(phone: string, incomingCookies: string[] = []): Promise<string[]> {
    // This suite deliberately signs the same phone in more than once (e.g.
    // a second device, or after sign-out) — real logins are minutes apart,
    // but a test runs in milliseconds, well under the 30s per-phone resend
    // cooldown. Clear it explicitly rather than slow the suite down.
    await prisma.otpAttempt.deleteMany({});
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .set("x-requested-with", "medpass")
      .set("Cookie", incomingCookies)
      .send({ phone, code: CODE, device: { kind: "browser" }, rememberDevice: true })
      .expect(201);
    return cookiesOf(verify);
  }

  let trustCookieA: string;

  it("verify with rememberDevice:true mints trust; device-login then succeeds with just the phone", async () => {
    const cookies = await signInRemembered(PHONE_A);
    trustCookieA = findCookie(cookies, "medpass_device_trust")!;
    expect(trustCookieA).toBeDefined();

    const login = await request(app.getHttpServer())
      .post("/v1/auth/device-login")
      .set("x-requested-with", "medpass")
      .set("Cookie", [trustCookieA])
      .send({ phone: PHONE_A })
      .expect(201);
    expect(login.body.user).toBeDefined();
  });

  it("no trust cookie at all is rejected with device_not_trusted", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/auth/device-login")
      .set("x-requested-with", "medpass")
      .send({ phone: PHONE_A })
      .expect(401);
    expect(res.body.code).toBe("device_not_trusted");
  });

  it("a valid trust cookie with the wrong phone gets the same generic error — no enumeration", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/auth/device-login")
      .set("x-requested-with", "medpass")
      .set("Cookie", [trustCookieA])
      .send({ phone: PHONE_B })
      .expect(401);
    expect(res.body.code).toBe("device_not_trusted");
  });

  it("rememberDevice:false mints no trust for a fresh device", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE_D }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .set("x-requested-with", "medpass")
      .send({ phone: PHONE_D, code: CODE, device: { kind: "browser" }, rememberDevice: false })
      .expect(201);
    const trustCookie = findCookie(cookiesOf(verify), "medpass_device_trust");

    await request(app.getHttpServer())
      .post("/v1/auth/device-login")
      .set("x-requested-with", "medpass")
      .set("Cookie", trustCookie ? [trustCookie] : [])
      .send({ phone: PHONE_D })
      .expect(401);
  });

  it("a different phone completing full OTP on the same trust cookie supersedes it — the old token stops working", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE_B }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .set("x-requested-with", "medpass")
      .set("Cookie", [trustCookieA])
      .send({ phone: PHONE_B, code: CODE, device: { kind: "browser" }, rememberDevice: true })
      .expect(201);

    // A's old token must no longer work for A.
    await request(app.getHttpServer())
      .post("/v1/auth/device-login")
      .set("x-requested-with", "medpass")
      .set("Cookie", [trustCookieA])
      .send({ phone: PHONE_A })
      .expect(401);

    // B's new token works for B.
    const trustCookieB = findCookie(cookiesOf(verify), "medpass_device_trust")!;
    await request(app.getHttpServer())
      .post("/v1/auth/device-login")
      .set("x-requested-with", "medpass")
      .set("Cookie", [trustCookieB])
      .send({ phone: PHONE_B })
      .expect(201);
  });

  it("signing out revokes this device's trust — device-login fails afterward", async () => {
    const cookies = await signInRemembered(PHONE_A);
    const trustCookie = findCookie(cookies, "medpass_device_trust")!;

    await request(app.getHttpServer()).post("/v1/auth/logout").set("x-requested-with", "medpass").set("Cookie", cookies).expect(204);

    await request(app.getHttpServer())
      .post("/v1/auth/device-login")
      .set("x-requested-with", "medpass")
      .set("Cookie", [trustCookie])
      .send({ phone: PHONE_A })
      .expect(401);
  });

  it("remote device revoke kills a live session immediately and disables device-login — not just the session", async () => {
    const cookies = await signInRemembered(PHONE_C);
    const trustCookie = findCookie(cookies, "medpass_device_trust")!;

    const list = await request(app.getHttpServer()).get("/v1/auth/devices").set("Cookie", cookies).expect(200);
    const device = list.body.items.find((d: { isCurrent: boolean }) => d.isCurrent);
    expect(device).toMatchObject({ trusted: true, hasLiveSession: true });

    await request(app.getHttpServer())
      .delete(`/v1/auth/devices/${device.id}`)
      .set("x-requested-with", "medpass")
      .set("Cookie", cookies)
      .expect(204);

    // The live session this exact cookie represents must be dead immediately.
    await request(app.getHttpServer()).get("/v1/profiles").set("Cookie", cookies).expect(401);

    // And the remembered-login shortcut must be gone too, not just this one session.
    await request(app.getHttpServer())
      .post("/v1/auth/device-login")
      .set("x-requested-with", "medpass")
      .set("Cookie", [trustCookie])
      .send({ phone: PHONE_C })
      .expect(401);
  });

  it("GET /auth/devices shows a trusted-but-dormant device (no live session) alongside the current one", async () => {
    const device1Cookies = await signInRemembered(PHONE_E);
    const device1 = (await request(app.getHttpServer()).get("/v1/auth/devices").set("Cookie", device1Cookies).expect(200)).body.items.find(
      (d: { isCurrent: boolean }) => d.isCurrent,
    );

    // Simulate device 1's 12h session having expired days ago — its trust
    // cookie would still be valid in a real browser, just dormant right now.
    await prisma.session.updateMany({ where: { userDeviceId: device1.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    // A second, independent device for the same person (no incoming trust cookie sent).
    const device2Cookies = await signInRemembered(PHONE_E);

    const list = await request(app.getHttpServer()).get("/v1/auth/devices").set("Cookie", device2Cookies).expect(200);
    const items: Array<{ id: string; trusted: boolean; hasLiveSession: boolean; isCurrent: boolean }> = list.body.items;
    expect(items.find((d) => d.id === device1.id)).toMatchObject({ trusted: true, hasLiveSession: false, isCurrent: false });
    expect(items.find((d) => d.isCurrent)).toMatchObject({ trusted: true, hasLiveSession: true });
  });
});
