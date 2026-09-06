import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFieldCrypto, keyringFromEnv } from "@medpass/field-crypto";
import { getPrisma, type PrismaClient } from "@medpass/database";
import type { WebPushPayload, WebPushSubscriptionDetails } from "@medpass/notifications";
import { dispatchPendingNotifications, type PushSender } from "./dispatch-notifications";
import { queueRefillLowReminders } from "./refill-low";

/**
 * V2 Phase 6 caregiver notification kinds (docs_v2/06 P6-4) and the
 * per-kind channel/frequency control (docs_v2/04 §12, H-48), exercised
 * through the real dispatch pass against a real database with a fake push
 * sender. Needs a database; skipped without DATABASE_URL (same convention
 * as the backfill tests).
 */
const KEY = { FIELD_ENCRYPTION_KEY: process.env.FIELD_ENCRYPTION_KEY ?? "ci-field-key-not-secret-32bytes!" };
const crypto = createFieldCrypto(keyringFromEnv(KEY));
const IST = "Asia/Kolkata";

class FakePush implements PushSender {
  sends: Array<{ endpoint: string; payload: WebPushPayload }> = [];
  async send(subscription: WebPushSubscriptionDetails, payload: WebPushPayload) {
    this.sends.push({ endpoint: subscription.endpoint, payload });
    return { ok: true };
  }
}

const silent = { info() {}, warn() {}, error() {} };

describe.skipIf(!process.env.DATABASE_URL)("caregiver notification kinds + per-kind controls", () => {
  let prisma: PrismaClient;
  let ownerId: string;
  let profileId: string;
  let viewerId: string; // caregiver: view_medications
  let filerId: string; // caregiver: full_management — the one who filed the prescription
  let bystanderId: string; // caregiver: record_doses only
  const endpoints: Record<string, string> = {};
  let push: FakePush;

  async function user(tag: string) {
    const u = await prisma.user.create({ data: { phoneDigest: `cgn-${tag}-${randomUUID()}`, phoneCiphertext: "not-a-real-ciphertext" } });
    return u.id;
  }

  async function channel(userId: string, tag: string) {
    const endpoint = `https://push.example.test/${tag}/${randomUUID()}`;
    endpoints[tag] = endpoint;
    await prisma.notificationChannel.create({
      data: {
        userId,
        channel: "web_push",
        addressCiphertext: crypto.encrypt(JSON.stringify({ endpoint, keys: { p256dh: "k", auth: "a" } })),
        endpointDigest: createHash("sha256").update(endpoint).digest("hex"),
        status: "active",
      },
    });
  }

  async function caregiver(userId: string, scopes: string[]) {
    await prisma.caregiverRelationship.create({
      data: {
        patientProfileId: profileId,
        caregiverUserId: userId,
        invitedPhoneDigest: `d-${randomUUID()}`,
        relationship: "child",
        status: "active",
        acceptedAt: new Date(),
        permissions: { create: scopes.map((scope) => ({ scope: scope as never, grantedByUserId: ownerId })) },
      },
    });
  }

  async function pending(kind: string, extra: { triggeredByUserId?: string; createdAt?: Date; patientMedicationId?: string } = {}) {
    return prisma.notification.create({
      data: {
        patientProfileId: profileId,
        kind: kind as never,
        privacyMode: "generic",
        dedupeKey: `${kind}:${randomUUID()}`,
        status: "pending",
        triggeredByUserId: extra.triggeredByUserId ?? null,
        patientMedicationId: extra.patientMedicationId ?? null,
        ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
      },
    });
  }

  async function setControl(channelFrequencyJson: object | null) {
    await prisma.notificationPreference.upsert({
      where: { patientProfileId: profileId },
      create: { patientProfileId: profileId, pushEnabled: true, quietHoursEnabled: false, channelFrequencyJson: channelFrequencyJson as never },
      update: { pushEnabled: true, quietHoursEnabled: false, channelFrequencyJson: channelFrequencyJson as never },
    });
  }

  const dispatch = (now?: Date) => dispatchPendingNotifications(prisma, { pushSender: push, config: KEY, log: silent, now });

  beforeAll(async () => {
    prisma = getPrisma();
    ownerId = await user("owner");
    viewerId = await user("viewer");
    filerId = await user("filer");
    bystanderId = await user("bystander");
    const profile = await prisma.patientProfile.create({ data: { ownerUserId: ownerId, displayName: "Caregiver Notif Fixture", timezone: IST } });
    profileId = profile.id;
    await Promise.all([channel(ownerId, "owner"), channel(viewerId, "viewer"), channel(filerId, "filer"), channel(bystanderId, "bystander")]);
    await caregiver(viewerId, ["view_medications"]);
    await caregiver(filerId, ["full_management"]);
    await caregiver(bystanderId, ["record_doses"]);
    await setControl(null);
  });

  beforeEach(() => {
    push = new FakePush();
  });

  afterAll(async () => {
    await prisma.notificationAttempt.deleteMany({ where: { notification: { patientProfileId: profileId } } });
    await prisma.notification.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.notificationPreference.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.medicationRefillPlan.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.medicationInstruction.deleteMany({ where: { patientMedication: { patientProfileId: profileId } } });
    await prisma.patientMedication.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.caregiverPermission.deleteMany({ where: { caregiverRelationship: { patientProfileId: profileId } } });
    await prisma.caregiverRelationship.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.notificationChannel.deleteMany({ where: { userId: { in: [ownerId, viewerId, filerId, bystanderId] } } });
    await prisma.patientProfile.delete({ where: { id: profileId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, viewerId, filerId, bystanderId] } } });
    await prisma.$disconnect();
  });

  it("new_prescription reaches caregivers who can see medicines — never the patient, the filer, or an unrelated scope", async () => {
    const n = await pending("new_prescription", { triggeredByUserId: filerId });
    const summary = await dispatch();
    expect(summary.sent).toBe(1);

    const targets = push.sends.map((s) => s.endpoint);
    expect(targets).toEqual([endpoints.viewer]);
    expect(push.sends[0]!.payload.title).toBe("New prescription");
    // The medicine name or any PHI never rides on a generic caregiver push.
    expect(JSON.stringify(push.sends[0]!.payload)).not.toMatch(/fixture/i);

    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id }, include: { attempts: true } });
    expect(row.status).toBe("done");
    expect(row.attempts).toEqual([expect.objectContaining({ channel: "web_push", status: "sent" })]);
  });

  it("new_test_result goes to whoever can view tests (view_medications grants it additively); the filer is excluded", async () => {
    await pending("new_test_result", { triggeredByUserId: viewerId });
    await dispatch();
    expect(push.sends.map((s) => s.endpoint)).toEqual([endpoints.filer]);
    expect(push.sends[0]!.payload.title).toBe("New test result");
  });

  it("a caregiver kind with nobody left to tell is cancelled, not left pending forever", async () => {
    // Everyone entitled is excluded or missing: the only eligible caregivers are viewer + filer.
    await prisma.caregiverPermission.updateMany({
      where: { caregiverRelationship: { patientProfileId: profileId, caregiverUserId: viewerId } },
      data: { revokedAt: new Date() },
    });
    const n = await pending("new_prescription", { triggeredByUserId: filerId });
    await dispatch();
    expect(push.sends).toHaveLength(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("cancelled");
    await prisma.caregiverPermission.updateMany({
      where: { caregiverRelationship: { patientProfileId: profileId, caregiverUserId: viewerId } },
      data: { revokedAt: null },
    });
  });

  it("frequency=off cancels a caregiver kind without sending", async () => {
    await setControl({ new_prescription: { channels: ["web_push"], frequency: "off" } });
    const n = await pending("new_prescription", { triggeredByUserId: filerId });
    const summary = await dispatch();
    expect(push.sends).toHaveLength(0);
    expect(summary.cancelled).toBeGreaterThanOrEqual(1);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("cancelled");
    await setControl(null);
  });

  it("frequency=off leaves a refill reminder pending — its in-app list is still true — but sends nothing", async () => {
    await setControl({ refill: { channels: ["web_push"], frequency: "off" } });
    const n = await pending("refill");
    await dispatch();
    expect(push.sends).toHaveLength(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("pending");
    await prisma.notification.update({ where: { id: n.id }, data: { status: "cancelled" } });
    await setControl(null);
  });

  it("channels=[] on a kind narrows delivery to nothing, so the row is cancelled", async () => {
    await setControl({ new_prescription: { channels: [], frequency: "immediate" } });
    const n = await pending("new_prescription", { triggeredByUserId: filerId });
    await dispatch();
    expect(push.sends).toHaveLength(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("cancelled");
    await setControl(null);
  });

  it("H-48: a dose_reminder is sent even when the stored control says off", async () => {
    await setControl({ dose_reminder: { channels: [], frequency: "off" } });
    const n = await pending("dose_reminder");
    await dispatch();
    // Owner + the full_management caregiver (manage_reminders is implied); the view-only caregiver is not a reminder recipient.
    expect(push.sends.map((s) => s.endpoint).sort()).toEqual([endpoints.filer, endpoints.owner].sort());
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("done");
    await setControl(null);
  });

  it("daily_digest holds rows until 08:00 local, then folds them into one send per kind", async () => {
    await setControl({ new_prescription: { channels: ["web_push"], frequency: "daily_digest" } });
    // 2026-09-05 23:00 IST = 17:30Z — both created "last night".
    const createdAt = new Date("2026-09-05T17:30:00.000Z");
    const a = await pending("new_prescription", { triggeredByUserId: filerId, createdAt });
    const b = await pending("new_prescription", { triggeredByUserId: filerId, createdAt });

    // 06:30 IST: too early — deferred, nothing sent.
    let summary = await dispatch(new Date("2026-09-06T01:00:00.000Z"));
    expect(push.sends).toHaveLength(0);
    expect(summary.deferred).toBeGreaterThanOrEqual(2);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("pending");

    // 08:01 IST: one digest push to the one eligible caregiver, both rows done, each with its own attempt.
    summary = await dispatch(new Date("2026-09-06T02:31:00.000Z"));
    expect(push.sends).toHaveLength(1);
    expect(push.sends[0]!.endpoint).toBe(endpoints.viewer);
    expect(push.sends[0]!.payload.title).toBe("Daily summary");
    expect(push.sends[0]!.payload.body).toContain("2 new prescription(s)");
    expect(summary.digested).toBe(2);
    for (const id of [a.id, b.id]) {
      const row = await prisma.notification.findUniqueOrThrow({ where: { id }, include: { attempts: true } });
      expect(row.status).toBe("done");
      expect(row.attempts).toHaveLength(1);
    }
    await setControl(null);
  });

  it("refill_low is queued from the refill plan when the projected run-out is within 5 days, superseding the previous projection", async () => {
    const med = await prisma.patientMedication.create({
      data: {
        patientProfileId: profileId,
        enteredName: "Refill Low Fixture",
        source: "manual",
        status: "current",
        instructions: { create: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", confirmedByUserId: ownerId } },
      },
    });
    const now = new Date("2026-09-06T04:30:00.000Z"); // 10:00 IST, 6 Sept
    const plan = await prisma.medicationRefillPlan.create({
      data: { patientMedicationId: med.id, patientProfileId: profileId, quantityOnHand: 3, dailyConsumption: 1, projectedRunOutOn: new Date("2026-09-20T00:00:00Z") },
    });

    // 14 days out: nothing.
    expect(await queueRefillLowReminders(prisma, { now })).toEqual({ queued: 0 });

    // 4 days out: one row; a second run is a no-op.
    await prisma.medicationRefillPlan.update({ where: { id: plan.id }, data: { projectedRunOutOn: new Date("2026-09-10T00:00:00Z") } });
    expect(await queueRefillLowReminders(prisma, { now })).toEqual({ queued: 1 });
    expect(await queueRefillLowReminders(prisma, { now })).toEqual({ queued: 0 });
    const first = await prisma.notification.findFirstOrThrow({ where: { patientMedicationId: med.id, kind: "refill_low" } });
    expect(first.dedupeKey).toBe(`refill_low:${med.id}:2026-09-10`);

    // A new projection (partial refill) supersedes the old row.
    await prisma.medicationRefillPlan.update({ where: { id: plan.id }, data: { projectedRunOutOn: new Date("2026-09-11T00:00:00Z") } });
    expect(await queueRefillLowReminders(prisma, { now })).toEqual({ queued: 1 });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("cancelled");

    // And it dispatches to medicine-viewing caregivers only — never the patient (who has the patient-facing `refill`).
    await dispatch();
    expect(push.sends.map((s) => s.endpoint).sort()).toEqual([endpoints.filer, endpoints.viewer].sort());
    expect(push.sends[0]!.payload.title).toBe("Running low");
  });
});
