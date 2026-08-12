import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import cookieParser from "cookie-parser";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { phoneDigest } from "../src/common/crypto";

/**
 * First-party acquisition attribution (OD-LP-8). The controlled `website`
 * source is persisted once, at account creation (first-touch), and never
 * overwritten or set from an arbitrary string.
 */
describe("Acquisition attribution e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
  const phones: string[] = [];

  const freshPhone = () => {
    const p = "+9197" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    phones.push(p);
    return p;
  };

  const signIn = async (phone: string, acquisitionSource?: string) => {
    // Clear per-IP request rate-limit and any prior OTP attempt so a returning
    // patient (same phone, second sign-in) isn't blocked by the resend limiter
    // — the point under test is the attribution, not rate limiting.
    await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: "otp_" } } });
    await prisma.otpAttempt.deleteMany({ where: { phoneDigest: phoneDigest(phone) } });
    await request(app.getHttpServer()).post("/v1/auth/otp/request").set("x-requested-with", "medpass").send({ phone }).expect(202);
    return request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .set("x-requested-with", "medpass")
      .send({ phone, code: CODE, device: { kind: "browser" }, ...(acquisitionSource !== undefined ? { acquisitionSource } : {}) })
      .expect(201);
  };

  const sourceOf = async (phone: string) =>
    (await prisma.user.findUnique({ where: { phoneDigest: phoneDigest(phone) } }))?.acquisitionSource ?? null;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Best-effort cleanup: these synthetic users own sessions/devices/profiles
    // with FKs, so a bare user delete can fail on teardown — remove children
    // first, and never let cleanup fail the suite.
    try {
      const userIds = (await prisma.user.findMany({ where: { phoneDigest: { in: phones.map(phoneDigest) } }, select: { id: true } })).map(
        (u) => u.id,
      );
      if (userIds.length) {
        await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.userDevice.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } catch {
      /* leave synthetic test users; they are clearly fake +9197… numbers */
    }
    await app.close();
  });

  it("persists src=website on the account at first sign-in", async () => {
    const phone = freshPhone();
    await signIn(phone, "website");
    expect(await sourceOf(phone)).toBe("website");
  });

  it("ignores an unknown source value (never stores arbitrary strings)", async () => {
    const phone = freshPhone();
    await signIn(phone, "totally-made-up");
    expect(await sourceOf(phone)).toBeNull();
  });

  it("stores null when no source is supplied (existing signup unaffected)", async () => {
    const phone = freshPhone();
    await signIn(phone);
    expect(await sourceOf(phone)).toBeNull();
  });

  it("is first-touch: a returning patient does not overwrite (or newly set) the source", async () => {
    const phone = freshPhone();
    await signIn(phone, "website"); // first touch → website
    await signIn(phone); // revisit with no source → unchanged
    expect(await sourceOf(phone)).toBe("website");

    const phone2 = freshPhone();
    await signIn(phone2); // first touch → no source
    await signIn(phone2, "website"); // later visit carries source → must NOT backfill
    expect(await sourceOf(phone2)).toBeNull();
  });
});
