import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma, type PrismaClient } from "@medpass/database";
import { backfillHealthEvents } from "./backfill-health-events";
import { backfillProvenance, legacySourceToV2, medicationSourceToV2 } from "./backfill-provenance";

/**
 * Phase 1 backfills against V1-shaped rows (docs_v2/04 §14 rows 4/5): every
 * seeded row starts with a null provenance block and no timeline event, the
 * way the additive migrations left production. Needs a database; skipped
 * without DATABASE_URL (same convention as the worker integration tests).
 */
describe("legacySourceToV2", () => {
  it("maps V1 values, keeps V2 values, defaults the rest", () => {
    expect(legacySourceToV2("patient")).toBe("user_entered");
    expect(legacySourceToV2("document")).toBe("ocr_extracted");
    expect(legacySourceToV2("professional")).toBe("clinic_entered");
    expect(legacySourceToV2("caregiver_entered")).toBe("caregiver_entered");
    expect(legacySourceToV2(null)).toBe("user_entered");
    expect(medicationSourceToV2("extraction")).toBe("ocr_extracted");
    expect(medicationSourceToV2("manual")).toBe("user_entered");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("Phase 1 backfills", () => {
  let prisma: PrismaClient;
  let userId: string;
  let profileId: string;
  let extractedMedicationId: string;
  let manualMedicationId: string;
  let shareLinkId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const user = await prisma.user.create({
      data: { phoneDigest: `backfill-test-${randomUUID()}`, phoneCiphertext: "not-a-real-ciphertext" },
    });
    userId = user.id;
    const profile = await prisma.patientProfile.create({
      data: { ownerUserId: userId, displayName: "Backfill Fixture", timezone: "Asia/Kolkata" },
    });
    profileId = profile.id;

    // V1-shaped rows: no provenance block anywhere, no health events.
    const extracted = await prisma.patientMedication.create({
      data: {
        patientProfileId: profileId,
        enteredName: "Extracted Tablet",
        source: "extraction",
        instructions: { create: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", confirmedByUserId: userId } },
        changes: { create: [{ change: "created", detail: { source: "extraction" }, actorUserId: userId }] },
      },
    });
    extractedMedicationId = extracted.id;
    const manual = await prisma.patientMedication.create({
      data: {
        patientProfileId: profileId,
        enteredName: "Manual Tablet",
        source: "manual",
        status: "stopped",
        instructions: { create: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "BD", confirmedByUserId: userId } },
        changes: {
          create: [
            { change: "created", detail: { source: "manual" }, actorUserId: userId, occurredAt: new Date("2026-05-01T04:30:00Z") },
            { change: "status_changed", detail: { from: "current", to: "stopped" }, actorUserId: userId, occurredAt: new Date("2026-06-01T04:30:00Z") },
          ],
        },
      },
    });
    manualMedicationId = manual.id;
    await prisma.prescription.create({ data: { patientProfileId: profileId, prescribedAt: new Date("2026-04-10"), notes: "v1" } });
    await prisma.medicalReport.create({
      data: {
        patientProfileId: profileId,
        kind: "blood_test",
        testedAt: new Date("2026-04-12"),
        values: { create: [{ patientProfileId: profileId, analyte: "hba1c", enteredValue: "7.1", recordedByUserId: userId }] },
      },
    });
    await prisma.glucoseReading.create({
      data: { patientProfileId: profileId, measuredAt: new Date("2026-04-13T02:00:00Z"), context: "before_breakfast", valueMgDl: 110, recordedByUserId: userId },
    });
    await prisma.bloodPressureReading.create({
      data: { patientProfileId: profileId, measuredAt: new Date("2026-04-14T02:00:00Z"), systolic: 120, diastolic: 80, recordedByUserId: userId },
    });
    await prisma.weightReading.create({
      data: { patientProfileId: profileId, measuredAt: new Date("2026-04-15T02:00:00Z"), weightKg: 70.5, recordedByUserId: userId },
    });
    await prisma.checkupRecord.create({
      data: { patientProfileId: profileId, checkupDate: new Date("2026-04-16"), hba1cPercent: 7.0, weightKg: 70, recordedByUserId: userId },
    });
    await prisma.patientAllergy.create({ data: { patientProfileId: profileId, label: "Penicillin", source: "document", recordedByUserId: userId } });
    await prisma.patientCondition.create({ data: { patientProfileId: profileId, label: "Type 2 diabetes", source: "patient", recordedByUserId: userId } });
    const link = await prisma.shareLink.create({
      data: {
        tokenHash: `backfill-test-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600_000),
        sharePackage: { create: { patientProfileId: profileId, sections: { medications: true }, createdByUserId: userId } },
      },
    });
    shareLinkId = link.id;
  });

  afterAll(async () => {
    if (!profileId) return;
    await prisma.healthEvent.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.shareAccessEvent.deleteMany({ where: { shareLink: { sharePackage: { patientProfileId: profileId } } } });
    await prisma.shareLink.deleteMany({ where: { sharePackage: { patientProfileId: profileId } } });
    await prisma.sharePackage.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.patientCondition.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.patientAllergy.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.checkupRecord.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.weightReading.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.bloodPressureReading.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.glucoseReading.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.reportValue.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.medicalReport.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.prescription.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.medicationChange.deleteMany({ where: { patientMedication: { patientProfileId: profileId } } });
    await prisma.medicationInstruction.deleteMany({ where: { patientMedication: { patientProfileId: profileId } } });
    await prisma.patientMedication.deleteMany({ where: { patientProfileId: profileId } });
    await prisma.patientProfile.delete({ where: { id: profileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("fills the provenance block on every V1 row, then is a no-op on re-run", async () => {
    const first = await backfillProvenance(prisma);
    for (const table of [
      "patient_medications",
      "medication_instructions",
      "prescriptions",
      "medical_reports",
      "report_values",
      "glucose_readings",
      "blood_pressure_readings",
      "weight_readings",
      "checkup_records",
      "patient_allergies",
      "patient_conditions",
    ]) {
      expect(first[table], table).toBeGreaterThanOrEqual(1);
    }

    const extracted = await prisma.patientMedication.findUniqueOrThrow({ where: { id: extractedMedicationId }, include: { instructions: true } });
    expect(extracted).toMatchObject({ provenanceSource: "ocr_extracted", verification: "patient_confirmed", recordedVia: "pwa" });
    expect(extracted.instructions[0]).toMatchObject({ provenanceSource: "ocr_extracted", verification: "patient_confirmed", recordedVia: "pwa" });
    const manual = await prisma.patientMedication.findUniqueOrThrow({ where: { id: manualMedicationId }, include: { instructions: true } });
    expect(manual.provenanceSource).toBe("user_entered");
    expect(manual.instructions[0]!.provenanceSource).toBe("user_entered");

    const allergy = await prisma.patientAllergy.findFirstOrThrow({ where: { patientProfileId: profileId } });
    expect(allergy).toMatchObject({ provenanceSource: "ocr_extracted", verification: "patient_confirmed", recordedVia: "pwa" });
    const condition = await prisma.patientCondition.findFirstOrThrow({ where: { patientProfileId: profileId } });
    expect(condition.provenanceSource).toBe("user_entered");
    for (const row of [
      await prisma.prescription.findFirstOrThrow({ where: { patientProfileId: profileId } }),
      await prisma.medicalReport.findFirstOrThrow({ where: { patientProfileId: profileId } }),
      await prisma.reportValue.findFirstOrThrow({ where: { patientProfileId: profileId } }),
      await prisma.glucoseReading.findFirstOrThrow({ where: { patientProfileId: profileId } }),
      await prisma.bloodPressureReading.findFirstOrThrow({ where: { patientProfileId: profileId } }),
      await prisma.weightReading.findFirstOrThrow({ where: { patientProfileId: profileId } }),
      await prisma.checkupRecord.findFirstOrThrow({ where: { patientProfileId: profileId } }),
    ]) {
      expect(row).toMatchObject({ provenanceSource: "user_entered", verification: "patient_confirmed", recordedVia: "pwa" });
    }

    // Nothing left to fill for this fixture; other fixtures in a shared DB may still count, so only assert ours.
    const second = await backfillProvenance(prisma);
    const stillNull = await prisma.patientMedication.count({ where: { patientProfileId: profileId, provenanceSource: null } });
    expect(stillNull).toBe(0);
    expect(Object.values(second).every((n) => Number.isInteger(n))).toBe(true);
  });

  it("projects every V1 row onto the timeline exactly once, even when re-run", async () => {
    const first = await backfillHealthEvents(prisma);
    for (const table of [
      "medication_changes",
      "prescriptions",
      "medical_reports",
      "glucose_readings",
      "blood_pressure_readings",
      "weight_readings",
      "checkup_records",
      "share_links",
      "patient_allergies",
      "patient_conditions",
    ]) {
      expect(first[table], table).toBeGreaterThanOrEqual(1);
    }

    const events = await prisma.healthEvent.findMany({ where: { patientProfileId: profileId }, orderBy: { occurredAt: "asc" } });
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(
      [
        "medicine_started", // extracted medicine
        "medicine_started", // manual medicine
        "medicine_stopped", // manual medicine status_changed → stopped
        "prescription",
        "test_result",
        "measurement",
        "measurement",
        "measurement",
        "doctor_visit",
        "share_created",
        "allergy_recorded",
        "condition_recorded",
      ].sort(),
    );
    // Local anchoring: a date-only row lands at noon in the patient's zone.
    const prescription = events.find((e) => e.kind === "prescription")!;
    expect(prescription.occurredAtLocal).toBe("2026-04-10T12:00:00");
    // Provenance is copied from the (now backfilled) source row; a share has none.
    expect(events.find((e) => e.kind === "test_result")).toMatchObject({ provenanceSource: "user_entered", verification: "patient_confirmed" });
    expect(events.find((e) => e.entityId === shareLinkId)).toMatchObject({ kind: "share_created", provenanceSource: null });
    const report = events.find((e) => e.kind === "test_result")!;
    expect((report.summary as { valueCount: number }).valueCount).toBe(1);

    await backfillHealthEvents(prisma);
    expect(await prisma.healthEvent.count({ where: { patientProfileId: profileId } })).toBe(events.length);
  });
});
