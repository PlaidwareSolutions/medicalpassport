import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFieldCrypto, keyringFromEnv } from "@medpass/field-crypto";
import { NOTIFICATION_DAILY_CAP_BY_KIND } from "@medpass/domain";
import { getPrisma, type PrismaClient } from "@medpass/database";
import type { WebPushPayload, WebPushSubscriptionDetails } from "@medpass/notifications";
import { dispatchPendingNotifications, type PushSender } from "./dispatch-notifications";
import { dailyCapFor } from "./notification-policy";

/**
 * P17 notification-overload guardrail (hazard H-48): at most N sends per
 * (profile, kind) per day from the constant table in @medpass/domain; rows
 * past the cap are cancelled; `dose_reminder` and `caregiver_escalation`
 * are never capped. Exercised through the real dispatch pass with a fake
 * push sender. Skipped without DATABASE_URL.
 */
const KEY = { FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY ?? "ci-field-key-not-secret-32bytes!" };
const crypto = createFieldCrypto(keyringFromEnv(KEY));
const silent = { info() {}, warn() {}, error() {} };

class FakePush implements PushSender {
  sends: WebPushPayload[] = [];
  async send(_subscription: WebPushSubscriptionDetails, payload: WebPushPayload) {
    this.sends.push(payload);
    return { ok: true };
  }
}

describe("dailyCapFor (pure)", () => {
  it("reads the domain table and never caps a protected kind", () => {
    expect(dailyCapFor("test_due")).toBe(NOTIFICATION_DAILY_CAP_BY_KIND.test_due);
    expect(dailyCapFor("refill")).toBe(NOTIFICATION_DAILY_CAP_BY_KIND.refill);
    expect(dailyCapFor("dose_reminder")).toBeUndefined();
    expect(dailyCapFor("caregiver_escalation")).toBeUndefined();
    expect(dailyCapFor("not_a_kind")).toBeUndefined();
  });

  it("the domain table itself never lists a protected kind (H-48)", () => {
    expect(Object.keys(NOTIFICATION_DAILY_CAP_BY_KIND)).not.toContain("dose_reminder");
    expect(Object.keys(NOTIFICATION_DAILY_CAP_BY_KIND)).not.toContain("caregiver_escalation");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("daily per-kind cap in the dispatch pass", () => {
  let prisma: PrismaClient;
  let ownerId: string;
  let profileId: string;
  let push: FakePush;

  async function pending(kind: string) {
    return prisma.notification.create({
      data: { patientProfileId: profileId, kind: kind as never, privacyMode: "generic", dedupeKey: `${kind}:${randomUUID()}`, status: "pending" },
    });
  }

  beforeAll(async () => {
    prisma = getPrisma();
    const owner = await prisma.user.create({ data: { phoneDigest: `cap-${randomUUID()}`, phoneCiphertext: "not-a-real-ciphertext" } });
    ownerId = owner.id;
    const profile = await prisma.patientProfile.create({ data: { ownerUserId: ownerId, displayName: "Daily Cap Fixture", timezone: "Asia/Kolkata" } });
    profileId = profile.id;
    const endpoint = `https://push.example.test/cap/${randomUUID()}`;
    await prisma.notificationChannel.create({
      data: {
        userId: ownerId,
        channel: "web_push",
        addressCiphertext: crypto.encrypt(JSON.stringify({ endpoint, keys: { p256dh: "k", auth: "a" } })),
        endpointDigest: createHash("sha256").update(endpoint).digest("hex"),
        status: "active",
      },
    });
    await prisma.notificationPreference.create({ data: { patientProfileId: profileId, pushEnabled: true, quietHoursEnabled: false } });
    push = new FakePush();
  });

  afterAll(async () => {
    await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: profileId } } });
    await prisma.notificationAttempt.deleteMany({ where: { notification: { patientProfileId: profileId } } });
    await prisma.notification.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.notificationPreference.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.notificationChannel.deleteMany({ where: { userId: ownerId } });
    await prisma.patientProfile.delete({ where: { id: profileId } });
    await prisma.user.delete({ where: { id: ownerId } });
  });

  it("sends up to the cap for a capped kind and cancels the rest, counting them", async () => {
    const cap = NOTIFICATION_DAILY_CAP_BY_KIND.test_due!;
    const rows = [];
    for (let i = 0; i < cap + 2; i++) rows.push(await pending("test_due"));

    const summary = await dispatchPendingNotifications(prisma, { pushSender: push, config: KEY, log: silent });
    expect(summary.capped).toBe(2);
    expect(push.sends.filter((p) => p.title === "Test due")).toHaveLength(cap);

    const after = await prisma.notification.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "asc" } });
    expect(after.filter((n) => n.status === "done")).toHaveLength(cap);
    expect(after.filter((n) => n.status === "cancelled")).toHaveLength(2);
    // Capped rows carry no attempt: nothing was tried.
    expect(await prisma.notificationAttempt.count({ where: { notificationId: { in: after.filter((n) => n.status === "cancelled").map((n) => n.id) } } })).toBe(0);

    // The cap is per day and per kind: a later tick the same day is still full.
    await pending("test_due");
    const again = await dispatchPendingNotifications(prisma, { pushSender: push, config: KEY, log: silent });
    expect(again.capped).toBe(1);
  });

  it("never caps dose reminders (H-48): every one of many is sent", async () => {
    const before = push.sends.length;
    const many = (NOTIFICATION_DAILY_CAP_BY_KIND.test_due ?? 3) * 3;
    for (let i = 0; i < many; i++) await pending("dose_reminder");
    const summary = await dispatchPendingNotifications(prisma, { pushSender: push, config: KEY, log: silent });
    expect(summary.capped).toBe(0);
    expect(push.sends.length - before).toBe(many);
  });
});
