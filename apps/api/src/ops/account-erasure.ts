import type { PrismaClient } from "@medpass/database";
import { writeAudit } from "@medpass/audit";
import type { BucketPurpose, ObjectStorage } from "@medpass/object-storage";
import { getObjectStorage } from "../common/storage";

/**
 * V1 manual account erasure (Session 12.5 §7–§12).
 *
 * An executable operational mechanism a privacy operator runs AFTER verifying
 * identity out-of-band (see docs/landing-page/retention-and-erasure.md). It is
 * NOT a public endpoint. Two phases: `plan()` (dry run — counts only, never
 * medicine names or health content) and `execute()` (irreversible delete).
 *
 * What it erases: the account (User), the profiles it OWNS and all of their
 * health data (medicines, doses, allergies/conditions/vitals/reports,
 * documents + the private objects behind them), the account's shares,
 * caregiver relationships (both on the user's profiles and the user's own
 * access to others'), sessions, devices, push channels, and OTP attempts.
 *
 * What legitimately remains: the hash-chained `audit_events` integrity log
 * (digests/coarse context only — no raw PHI), plus one `account.erased`
 * completion record holding COUNTS ONLY. Profiles the user only *claimed*
 * (owned by another account) are detached, not deleted — a documented V1
 * limitation. Downloaded share PDFs / copies already retained by a recipient
 * cannot be recalled, and encrypted backups expire on their own bounded
 * schedule (see the retention policy).
 */

const BUCKET_PURPOSE: Record<string, BucketPurpose> = {
  patient_docs: "patient-docs",
  ocr_tmp: "ocr-tmp",
};

export interface ErasurePlan {
  found: boolean;
  userId: string;
  /** Counts only — deliberately no names, phones, medicine names or health content. */
  counts: Record<string, number>;
  storedObjects: { id: string; bucket: string; objectKey: string }[];
}

export interface ErasureResult extends ErasurePlan {
  executed: boolean;
  objectsDeleted: number;
  objectDeleteErrors: number;
}

export class AccountErasure {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorage = getObjectStorage(),
  ) {}

  private async ownedProfileIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.patientProfile.findMany({ where: { ownerUserId: userId }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Dry run: what WOULD be erased, as counts. Safe to run anywhere. */
  async plan(userId: string): Promise<ErasurePlan> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return { found: false, userId, counts: {}, storedObjects: [] };

    const owned = await this.ownedProfileIds(userId);
    const p = this.prisma;
    const inOwned = { in: owned };
    const storedObjects = await p.storedObject.findMany({
      where: { document: { patientProfileId: inOwned } },
      select: { id: true, bucket: true, objectKey: true },
    });

    const counts: Record<string, number> = {
      profiles: owned.length,
      medications: await p.patientMedication.count({ where: { patientProfileId: inOwned } }),
      doseEvents: await p.doseEvent.count({ where: { patientMedication: { patientProfileId: inOwned } } }),
      allergies: await p.patientAllergy.count({ where: { patientProfileId: inOwned } }),
      conditions: await p.patientCondition.count({ where: { patientProfileId: inOwned } }),
      glucoseReadings: await p.glucoseReading.count({ where: { patientProfileId: inOwned } }),
      bloodPressureReadings: await p.bloodPressureReading.count({ where: { patientProfileId: inOwned } }),
      weightReadings: await p.weightReading.count({ where: { patientProfileId: inOwned } }),
      checkups: await p.checkupRecord.count({ where: { patientProfileId: inOwned } }),
      reports: await p.medicalReport.count({ where: { patientProfileId: inOwned } }),
      documents: await p.prescriptionDocument.count({ where: { patientProfileId: inOwned } }),
      storedObjects: storedObjects.length,
      sharePackages: await p.sharePackage.count({ where: { patientProfileId: inOwned } }),
      shareLinks: await p.shareLink.count({ where: { sharePackage: { patientProfileId: inOwned } } }),
      caregiverRelationships: await p.caregiverRelationship.count({
        where: { OR: [{ patientProfileId: inOwned }, { caregiverUserId: userId }] },
      }),
      sessions: await p.session.count({ where: { userId } }),
      devices: await p.userDevice.count({ where: { userId } }),
      notificationChannels: await p.notificationChannel.count({ where: { userId } }),
      claimedProfilesDetached: await p.patientProfile.count({
        where: { claimedByUserId: userId, ownerUserId: { not: userId } },
      }),
    };
    return { found: true, userId, counts, storedObjects };
  }

  /** Irreversible. Deletes the account's data in FK-safe order, then its private objects. */
  async execute(userId: string, ctx: { correlationId?: string; operatorNote?: string } = {}): Promise<ErasureResult> {
    const plan = await this.plan(userId);
    if (!plan.found) throw new Error(`account-erasure: no user with id ${userId}`);

    const owned = await this.ownedProfileIds(userId);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phoneDigest: true } });
    const inOwned = { in: owned };
    const storedObjectIds = plan.storedObjects.map((o) => o.id);

    await this.prisma.$transaction(
      async (tx) => {
        // leaf → root
        await tx.notificationAttempt.deleteMany({
          where: { OR: [{ notification: { patientProfileId: inOwned } }, { notificationChannel: { userId } }] },
        });
        await tx.notification.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.doseEvent.deleteMany({ where: { patientMedication: { patientProfileId: inOwned } } });
        await tx.scheduledDose.deleteMany({ where: { medicationSchedule: { patientMedication: { patientProfileId: inOwned } } } });
        await tx.medicationSchedule.deleteMany({ where: { patientMedication: { patientProfileId: inOwned } } });
        await tx.medicationInstruction.deleteMany({ where: { patientMedication: { patientProfileId: inOwned } } });
        await tx.medicationChange.deleteMany({ where: { patientMedication: { patientProfileId: inOwned } } });
        await tx.patientMedication.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.safetyFindingAction.deleteMany({ where: { finding: { patientProfileId: inOwned } } });
        await tx.safetyFinding.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.safetyEvaluation.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.shareAccessEvent.deleteMany({ where: { shareLink: { sharePackage: { patientProfileId: inOwned } } } });
        await tx.shareLink.deleteMany({ where: { sharePackage: { patientProfileId: inOwned } } });
        await tx.sharePackage.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.objectAccessEvent.deleteMany({ where: { storedObject: { document: { patientProfileId: inOwned } } } });
        await tx.extractionCandidate.deleteMany({ where: { extraction: { prescriptionDocument: { patientProfileId: inOwned } } } });
        await tx.prescriptionExtraction.deleteMany({ where: { prescriptionDocument: { patientProfileId: inOwned } } });
        await tx.prescriptionDocument.deleteMany({ where: { patientProfileId: inOwned } });
        if (storedObjectIds.length) await tx.storedObject.deleteMany({ where: { id: { in: storedObjectIds } } });
        await tx.reportValue.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.medicalReport.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.prescription.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.practitioner.deleteMany({ where: { createdByProfileId: inOwned } });
        await tx.patientAllergy.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.patientCondition.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.glucoseReading.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.bloodPressureReading.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.weightReading.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.checkupRecord.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.notificationPreference.deleteMany({ where: { patientProfileId: inOwned } });
        await tx.caregiverPermission.deleteMany({
          where: { caregiverRelationship: { OR: [{ patientProfileId: inOwned }, { caregiverUserId: userId }] } },
        });
        await tx.caregiverRelationship.deleteMany({ where: { OR: [{ patientProfileId: inOwned }, { caregiverUserId: userId }] } });
        await tx.consentEvent.deleteMany({ where: { consent: { patientProfileId: inOwned } } });
        await tx.consent.deleteMany({ where: { patientProfileId: inOwned } });
        // profiles the user only CLAIMED (owned by another account) are detached, not deleted
        await tx.patientProfile.updateMany({
          where: { claimedByUserId: userId, ownerUserId: { not: userId } },
          data: { claimedByUserId: null },
        });
        await tx.patientProfile.deleteMany({ where: { ownerUserId: userId } });
        await tx.notificationChannel.deleteMany({ where: { userId } });
        await tx.session.deleteMany({ where: { userId } });
        await tx.userDevice.deleteMany({ where: { userId } });
        if (user?.phoneDigest) await tx.otpAttempt.deleteMany({ where: { phoneDigest: user.phoneDigest } });
        // minimal completion record — COUNTS ONLY, no health content
        await writeAudit(tx, {
          action: "account.erased",
          actorUserId: null,
          actorType: "system",
          entityType: "user",
          entityId: userId,
          correlationId: ctx.correlationId,
          context: { counts: plan.counts, note: ctx.operatorNote ?? "manual erasure V1" },
        });
        await tx.user.delete({ where: { id: userId } });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    // Private objects are deleted AFTER the DB transaction commits — external
    // (S3/R2) calls must not run inside a DB transaction. Best-effort: an
    // orphaned object is cleaned up later and never resurrects the DB record.
    let objectsDeleted = 0;
    let objectDeleteErrors = 0;
    for (const o of plan.storedObjects) {
      const bucket = BUCKET_PURPOSE[o.bucket];
      if (!bucket) {
        objectDeleteErrors++;
        continue;
      }
      try {
        await this.storage.delete({ bucket, objectKey: o.objectKey });
        objectsDeleted++;
      } catch {
        objectDeleteErrors++;
      }
    }

    return { ...plan, executed: true, objectsDeleted, objectDeleteErrors };
  }
}
