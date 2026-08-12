import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { ObjectStorage } from "@medpass/object-storage";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { AccountErasure } from "../src/ops/account-erasure";

/**
 * V1 manual account erasure (Session 12.5 §7–§12). Synthetic data only — this
 * never touches a real patient. Verifies the erasure removes account access +
 * health data + shares + caregiver links + private documents, that the private
 * object is deleted, and that the retained completion record holds counts only
 * (no health content).
 */
describe("Account erasure V1 (synthetic)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const rnd = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const future = new Date(Date.now() + 10 * 24 * 3600 * 1000);
  const now = new Date();

  const deletedObjects: string[] = [];
  const fakeStorage = {
    delete: async ({ objectKey }: { objectKey: string }) => {
      deletedObjects.push(objectKey);
    },
  } as unknown as ObjectStorage;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    await app.init();
    prisma = moduleRef.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  async function seed() {
    const user = await prisma.user.create({ data: { phoneDigest: rnd(), phoneCiphertext: "cipher" } });
    const device = await prisma.userDevice.create({ data: { userId: user.id } });
    const session = await prisma.session.create({
      data: { userId: user.id, userDeviceId: device.id, tokenHash: rnd(), refreshTokenHash: rnd(), expiresAt: future, refreshExpiresAt: future },
    });
    const profile = await prisma.patientProfile.create({ data: { ownerUserId: user.id, displayName: "Erase Me" } });
    const med = await prisma.patientMedication.create({ data: { patientProfileId: profile.id, enteredName: "SecretMed", source: "manual" } });
    await prisma.medicationInstruction.create({
      data: { patientMedicationId: med.id, doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", confirmedByUserId: user.id },
    });
    const sched = await prisma.medicationSchedule.create({ data: { patientMedicationId: med.id, slots: [] } });
    const dose = await prisma.scheduledDose.create({ data: { medicationScheduleId: sched.id, dueAt: future, slotLabel: "morning", quantity: 1 } });
    await prisma.doseEvent.create({ data: { patientMedicationId: med.id, scheduledDoseId: dose.id, action: "taken", recordedByUserId: user.id, effectiveAt: now } });
    await prisma.patientAllergy.create({ data: { patientProfileId: profile.id, label: "SecretAllergy", recordedByUserId: user.id } });
    const obj = await prisma.storedObject.create({ data: { bucket: "patient_docs", objectKey: "patient_docs/2026/08/" + rnd() } });
    await prisma.prescriptionDocument.create({ data: { patientProfileId: profile.id, storedObjectId: obj.id } });
    await prisma.objectAccessEvent.create({ data: { storedObjectId: obj.id, operation: "presign_upload" } });
    const pkg = await prisma.sharePackage.create({ data: { patientProfileId: profile.id, sections: {}, createdByUserId: user.id } });
    const link = await prisma.shareLink.create({ data: { sharePackageId: pkg.id, tokenHash: rnd(), expiresAt: future } });
    await prisma.shareAccessEvent.create({ data: { shareLinkId: link.id, result: "success" } });
    const rel = await prisma.caregiverRelationship.create({ data: { patientProfileId: profile.id, invitedPhoneDigest: rnd(), relationship: "child" } });
    await prisma.caregiverPermission.create({ data: { caregiverRelationshipId: rel.id, scope: "view_medications", grantedByUserId: user.id } });
    const consent = await prisma.consent.create({ data: { patientProfileId: profile.id, type: "data_processing", purpose: "test" } });
    await prisma.consentEvent.create({ data: { consentId: consent.id, event: "granted" } });
    const chan = await prisma.notificationChannel.create({ data: { userId: user.id, addressCiphertext: "cipher", endpointDigest: rnd() } });
    const notif = await prisma.notification.create({ data: { patientProfileId: profile.id, dedupeKey: rnd() } });
    await prisma.notificationAttempt.create({ data: { notificationId: notif.id, notificationChannelId: chan.id, channel: "web_push" } });
    return { user, profile, med, session, obj, link, rel, chan };
  }

  it("dry-run plans counts without deleting anything", async () => {
    const f = await seed();
    const erasure = new AccountErasure(prisma, fakeStorage);
    const plan = await erasure.plan(f.user.id);
    expect(plan.found).toBe(true);
    expect(plan.counts.profiles).toBe(1);
    expect(plan.counts.medications).toBe(1);
    expect(plan.counts.documents).toBe(1);
    expect(plan.counts.storedObjects).toBe(1);
    expect(plan.counts.shareLinks).toBe(1);
    expect(plan.counts.caregiverRelationships).toBe(1);
    expect(plan.counts.sessions).toBe(1);
    // dry run must not delete
    expect(await prisma.user.findUnique({ where: { id: f.user.id } })).not.toBeNull();
    // cleanup this fixture via a real erasure so it doesn't linger
    await erasure.execute(f.user.id);
  });

  it("execute erases account, health data, shares, caregiver links, and the private object", async () => {
    const f = await seed();
    const erasure = new AccountErasure(prisma, fakeStorage);
    const res = await erasure.execute(f.user.id, { operatorNote: "ticket #synthetic" });

    expect(res.executed).toBe(true);
    expect(res.objectsDeleted).toBe(1);
    expect(deletedObjects).toContain(f.obj.objectKey);

    // account access + all owned data gone
    expect(await prisma.user.findUnique({ where: { id: f.user.id } })).toBeNull();
    expect(await prisma.patientProfile.findUnique({ where: { id: f.profile.id } })).toBeNull();
    expect(await prisma.patientMedication.findUnique({ where: { id: f.med.id } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: f.session.id } })).toBeNull();
    expect(await prisma.shareLink.findUnique({ where: { id: f.link.id } })).toBeNull();
    expect(await prisma.storedObject.findUnique({ where: { id: f.obj.id } })).toBeNull();
    expect(await prisma.caregiverRelationship.findUnique({ where: { id: f.rel.id } })).toBeNull();
    expect(await prisma.notificationChannel.findUnique({ where: { id: f.chan.id } })).toBeNull();
    expect(await prisma.patientAllergy.count({ where: { patientProfileId: f.profile.id } })).toBe(0);

    // retained completion record holds COUNTS ONLY — no health content
    const audit = await prisma.auditEvent.findFirst({ where: { action: "account.erased", entityId: f.user.id } });
    expect(audit).not.toBeNull();
    const ctx = JSON.stringify(audit!.context);
    expect(ctx).toContain("counts");
    expect(ctx).not.toContain("SecretMed");
    expect(ctx).not.toContain("SecretAllergy");

    // cleanup the retained audit row (synthetic)
    await prisma.auditEvent.deleteMany({ where: { entityId: f.user.id, action: "account.erased" } });
  });

  it("re-erasing a non-existent account is a controlled error, not destructive", async () => {
    const erasure = new AccountErasure(prisma, fakeStorage);
    await expect(erasure.execute("00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });
});
