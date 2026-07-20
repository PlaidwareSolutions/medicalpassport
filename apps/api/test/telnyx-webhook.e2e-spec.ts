import { generateKeyPairSync, sign as signEd25519, type KeyObject } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 4 follow-up e2e: the Telnyx delivery-status webhook receiver
 * (`TelnyxWebhookController`). Uses a self-generated Ed25519 keypair rather
 * than the real Telnyx key — verification only needs *some* genuine
 * Ed25519 signature/key pair to prove the check is real (accepts a valid
 * signature, rejects a tampered/wrong one), not Telnyx's actual private
 * key, which nobody outside Telnyx has. The `TELNYX_PUBLIC_KEY` env var is
 * set before `AppModule` is ever imported (dynamic imports inside
 * `beforeAll`, after the env var is set) since `env()` is read as a side
 * effect of the `@Module` decorator evaluating at import time, not lazily.
 * Real end-to-end delivery-status receipt was verified live against a
 * genuine Telnyx-sent webhook (see docs/22).
 */
describe("Telnyx delivery-status webhook e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let privateKey: KeyObject;
  let publicKeyBase64: string;

  const PHONE = "+919000005101";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const { publicKey, privateKey: pk } = generateKeyPairSync("ed25519");
    privateKey = pk;
    publicKeyBase64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32).toString("base64");
    process.env.TELNYX_PUBLIC_KEY = publicKeyBase64;

    const { Test } = await import("@nestjs/testing");
    const { AppModule } = await import("../src/app.module");
    const { PrismaService: PrismaServiceCtor } = await import("../src/common/prisma.service");

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false, rawBody: true });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaServiceCtor);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, notification_attempts, notifications,
        notification_channels, patient_medications, patient_profiles, users CASCADE
    `);
  }, 30000);

  afterAll(async () => {
    await app.close();
    delete process.env.TELNYX_PUBLIC_KEY;
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  let profileId: string;

  it("signs in and creates a profile", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    const token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Telnyx Webhook Test", preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  function sign(timestamp: string, rawBody: string): string {
    const signedData = Buffer.concat([Buffer.from(timestamp, "utf8"), Buffer.from("|", "utf8"), Buffer.from(rawBody, "utf8")]);
    return signEd25519(null, signedData, privateKey).toString("base64");
  }

  async function seedAttempt(providerMessageId: string): Promise<string> {
    const notification = await prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: "dose_reminder",
        privacyMode: "generic",
        dedupeKey: `webhook-test:${providerMessageId}`,
        status: "done",
      },
    });
    const attempt = await prisma.notificationAttempt.create({
      data: { notificationId: notification.id, channel: "sms", status: "sent", providerMessageId },
    });
    return attempt.id;
  }

  it("rejects a request with no signature headers at all", async () => {
    const body = JSON.stringify({ data: { event_type: "message.finalized", payload: { id: "x", to: [{ status: "delivered" }] } } });
    await request(app.getHttpServer())
      .post("/v1/webhooks/telnyx/sms")
      .set("content-type", "application/json")
      .send(body)
      .expect(401);
  });

  it("rejects a request with a signature that doesn't match the body", async () => {
    const attemptId = await seedAttempt("msg-tamper-1");
    const body = JSON.stringify({ data: { event_type: "message.finalized", payload: { id: "msg-tamper-1", to: [{ status: "delivered" }] } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const wrongSignature = sign(timestamp, JSON.stringify({ data: { event_type: "message.finalized", payload: { id: "different" } } }));

    await request(app.getHttpServer())
      .post("/v1/webhooks/telnyx/sms")
      .set("content-type", "application/json")
      .set("telnyx-signature-ed25519", wrongSignature)
      .set("telnyx-timestamp", timestamp)
      .send(body)
      .expect(401);

    const attempt = await prisma.notificationAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("sent"); // untouched — the forged request must never apply
  });

  it("applies a delivered outcome to the matching NotificationAttempt on a validly signed request", async () => {
    const attemptId = await seedAttempt("msg-delivered-1");
    const body = JSON.stringify({ data: { event_type: "message.finalized", payload: { id: "msg-delivered-1", to: [{ status: "delivered" }] } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, body);

    await request(app.getHttpServer())
      .post("/v1/webhooks/telnyx/sms")
      .set("content-type", "application/json")
      .set("telnyx-signature-ed25519", signature)
      .set("telnyx-timestamp", timestamp)
      .send(body)
      .expect(200);

    const attempt = await prisma.notificationAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("delivered");
  });

  it("applies a failed outcome with the real error digest", async () => {
    const attemptId = await seedAttempt("msg-failed-1");
    const body = JSON.stringify({
      data: {
        event_type: "message.finalized",
        payload: {
          id: "msg-failed-1",
          to: [{ status: "delivery_failed" }],
          errors: [{ code: "40329", detail: "Tollfree number is not verified" }],
        },
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, body);

    await request(app.getHttpServer())
      .post("/v1/webhooks/telnyx/sms")
      .set("content-type", "application/json")
      .set("telnyx-signature-ed25519", signature)
      .set("telnyx-timestamp", timestamp)
      .send(body)
      .expect(200);

    const attempt = await prisma.notificationAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("failed");
    expect(attempt.errorDigest).toBe("telnyx_40329: Tollfree number is not verified");
  });

  it("accepts (200) but silently ignores a valid webhook with no matching attempt", async () => {
    const body = JSON.stringify({ data: { event_type: "message.finalized", payload: { id: "msg-unknown-1", to: [{ status: "delivered" }] } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, body);

    await request(app.getHttpServer())
      .post("/v1/webhooks/telnyx/sms")
      .set("content-type", "application/json")
      .set("telnyx-signature-ed25519", signature)
      .set("telnyx-timestamp", timestamp)
      .send(body)
      .expect(200);
  });

  it("ignores a message.sent event (already captured synchronously) without changing attempt status", async () => {
    const attemptId = await seedAttempt("msg-sent-only-1");
    const body = JSON.stringify({ data: { event_type: "message.sent", payload: { id: "msg-sent-only-1", to: [{ status: "sent" }] } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(timestamp, body);

    await request(app.getHttpServer())
      .post("/v1/webhooks/telnyx/sms")
      .set("content-type", "application/json")
      .set("telnyx-signature-ed25519", signature)
      .set("telnyx-timestamp", timestamp)
      .send(body)
      .expect(200);

    const attempt = await prisma.notificationAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(attempt.status).toBe("sent");
  });
});
