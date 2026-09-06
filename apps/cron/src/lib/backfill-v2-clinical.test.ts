import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getPrisma, type PrismaClient } from "@medpass/database";
import { backfillDiagnostics, legacyReportKind, legacyReportTitle } from "./backfill-diagnostics";
import { backfillObservations } from "./backfill-observations";

/**
 * Phase 4/5 backfills against V1-shaped rows (docs_v2/04 §5.3, §6): the
 * seeded reports and diaries look exactly like production's, with no V2
 * mirror at all. Needs a database; skipped without DATABASE_URL (same
 * convention as the Phase 1 backfills and the worker integration tests).
 */
describe("legacy report mapping", () => {
  it("maps V1 report kinds onto diagnostic kinds", () => {
    expect(legacyReportKind("blood_test")).toBe("laboratory");
    expect(legacyReportKind("urine_test")).toBe("laboratory");
    expect(legacyReportKind("imaging")).toBe("imaging");
    expect(legacyReportKind("discharge_summary")).toBe("other");
    expect(legacyReportKind("something_new")).toBe("other");
  });

  it("prefers the patient's own label, falls back to the kind, never invents a name", () => {
    expect(legacyReportTitle("blood_test", "Thyroid panel")).toBe("Thyroid panel");
    expect(legacyReportTitle("blood_test", "   ")).toBe("Blood test");
    expect(legacyReportTitle("imaging", null)).toBe("Imaging");
  });
});

describe.skipIf(!process.env.DATABASE_URL)("Phase 4/5 backfills", () => {
  let prisma: PrismaClient;
  let profileId: string;
  let userId: string;
  let reportId: string;
  let valueId: string;
  let deletedReportId: string;
  let glucoseId: string;
  let bpId: string;
  let weightId: string;
  let checkupId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const user = await prisma.user.create({
      data: { phoneDigest: `v2-backfill-${randomUUID()}`, phoneCiphertext: "not-a-real-ciphertext" },
    });
    userId = user.id;
    const profile = await prisma.patientProfile.create({
      data: { ownerUserId: userId, displayName: "V2 Backfill Fixture", timezone: "Asia/Kolkata" },
    });
    profileId = profile.id;

    const report = await prisma.medicalReport.create({
      data: {
        patientProfileId: profileId,
        kind: "blood_test",
        label: "Lipid profile",
        facilityName: "Apollo Diagnostics",
        testedAt: new Date("2026-05-04"),
        provenanceSource: "user_entered",
        recordedByUserId: userId,
        verification: "patient_confirmed",
        recordedVia: "pwa",
      },
    });
    reportId = report.id;
    const value = await prisma.reportValue.create({
      data: {
        reportId,
        patientProfileId: profileId,
        analyte: "hba1c",
        enteredValue: "7.4",
        numericValue: "7.4",
        referenceText: "4.0 - 5.6",
        provenanceSource: "user_entered",
        recordedByUserId: userId,
        verification: "patient_confirmed",
      },
    });
    valueId = value.id;
    // A report the patient has already deleted: the mirror must be born
    // deleted rather than resurrecting it in the V2 model.
    const deleted = await prisma.medicalReport.create({
      data: { patientProfileId: profileId, kind: "imaging", deletedAt: new Date(), provenanceSource: "user_entered", recordedByUserId: userId },
    });
    deletedReportId = deleted.id;

    const glucose = await prisma.glucoseReading.create({
      data: {
        patientProfileId: profileId,
        measuredAt: new Date("2026-05-04T02:30:00Z"),
        context: "before_breakfast",
        valueMgDl: 118,
        note: "after a bad night",
        provenanceSource: "user_entered",
        recordedByUserId: userId,
        verification: "patient_confirmed",
      },
    });
    glucoseId = glucose.id;
    const bp = await prisma.bloodPressureReading.create({
      data: {
        patientProfileId: profileId,
        measuredAt: new Date("2026-05-04T03:00:00Z"),
        systolic: 138,
        diastolic: 86,
        pulseBpm: 72,
        provenanceSource: "user_entered",
        recordedByUserId: userId,
      },
    });
    bpId = bp.id;
    const weight = await prisma.weightReading.create({
      data: { patientProfileId: profileId, measuredAt: new Date("2026-05-04T03:05:00Z"), weightKg: "71.4", provenanceSource: "user_entered", recordedByUserId: userId },
    });
    weightId = weight.id;
    const checkup = await prisma.checkupRecord.create({
      data: {
        patientProfileId: profileId,
        checkupDate: new Date("2026-05-04"),
        fastingGlucoseMgDl: 104,
        postPrandialGlucoseMgDl: 156,
        hba1cPercent: "7.4",
        bloodPressureSystolic: 132,
        bloodPressureDiastolic: 84,
        weightKg: "71.0",
        waistCircumferenceCm: "94",
        cholesterolMgDl: 188,
        provenanceSource: "user_entered",
        recordedByUserId: userId,
      },
    });
    checkupId = checkup.id;
  }, 30000);

  it("mirrors V1 reports and values, keeping the label, facility and provenance", async () => {
    await backfillDiagnostics(prisma);

    const mirror = await prisma.diagnosticReport.findUnique({ where: { legacyMedicalReportId: reportId } });
    expect(mirror).toMatchObject({
      kind: "laboratory",
      title: "Lipid profile",
      facilityNameText: "Apollo Diagnostics",
      provenanceSource: "user_entered",
      verification: "patient_confirmed",
    });
    expect(mirror!.testedAt?.toISOString().slice(0, 10)).toBe("2026-05-04");

    const result = await prisma.diagnosticResult.findUnique({ where: { legacyReportValueId: valueId } });
    expect(result).toMatchObject({
      diagnosticReportId: mirror!.id,
      analyteKey: "hba1c",
      enteredValueText: "7.4",
      // Filled from @medpass/terminology, never by the client.
      loincCode: "4548-4",
      unit: "%",
      referenceText: "4.0 - 5.6",
    });
  }, 30000);

  it("carries a V1 soft-delete across rather than resurrecting the row", async () => {
    const mirror = await prisma.diagnosticReport.findUnique({ where: { legacyMedicalReportId: deletedReportId } });
    expect(mirror?.deletedAt).not.toBeNull();
  });

  it("mirrors the V1 diaries, splitting a blood pressure from its pulse", async () => {
    await backfillObservations(prisma);

    const glucose = await prisma.observation.findUnique({
      where: { legacyEntityType_legacyId: { legacyEntityType: "glucose_reading", legacyId: glucoseId } },
    });
    expect(glucose).toMatchObject({ concept: "blood_glucose", unit: "mg/dL", context: "before_breakfast", notes: "after a bad night" });
    expect(glucose!.valueNumeric!.toString()).toBe("118");
    // 02:30 UTC is 08:00 in Kolkata — the patient's own morning.
    expect(glucose!.measuredAtLocal).toBe("2026-05-04T08:00:00");

    const bp = await prisma.observation.findUnique({
      where: { legacyEntityType_legacyId: { legacyEntityType: "blood_pressure_reading", legacyId: bpId } },
    });
    expect(bp).toMatchObject({ concept: "blood_pressure", unit: "mm[Hg]" });
    expect(bp!.valueNumeric!.toString()).toBe("138");
    expect(bp!.valueNumeric2!.toString()).toBe("86");

    const pulse = await prisma.observation.findUnique({
      where: { legacyEntityType_legacyId: { legacyEntityType: "blood_pressure_reading_pulse", legacyId: bpId } },
    });
    expect(pulse).toMatchObject({ concept: "heart_rate", unit: "/min" });
    expect(pulse!.valueNumeric!.toString()).toBe("72");

    const weight = await prisma.observation.findUnique({
      where: { legacyEntityType_legacyId: { legacyEntityType: "weight_reading", legacyId: weightId } },
    });
    expect(weight).toMatchObject({ concept: "body_weight", unit: "kg" });
  }, 30000);

  it("copies the check-up metrics that are measurements and leaves the lab analytes alone", async () => {
    const mirrors = await prisma.observation.findMany({ where: { legacyId: checkupId } });
    const byType = new Map(mirrors.map((m) => [m.legacyEntityType, m]));
    expect([...byType.keys()].sort()).toEqual([
      "checkup_record_blood_pressure",
      "checkup_record_fasting_glucose",
      "checkup_record_post_prandial_glucose",
      "checkup_record_waist",
      "checkup_record_weight",
    ]);
    expect(byType.get("checkup_record_fasting_glucose")).toMatchObject({ concept: "blood_glucose", context: "fasting" });
    // Post-prandial has no honest context in the enum, so it gets none
    // rather than an invented meal.
    expect(byType.get("checkup_record_post_prandial_glucose")!.context).toBeNull();
    // HbA1c and cholesterol are lab analytes; they belong to DiagnosticResult.
    expect([...byType.keys()].some((k) => k!.includes("hba1c") || k!.includes("cholesterol"))).toBe(false);
  }, 30000);

  it("is idempotent — a second run creates nothing", async () => {
    // Counted per profile, not from the jobs' global totals: both backfills
    // sweep the whole database, so a fixture another spec seeded in parallel
    // would show up in the totals and say nothing about idempotence here.
    const count = async () => ({
      reports: await prisma.diagnosticReport.count({ where: { patientProfileId: profileId } }),
      results: await prisma.diagnosticResult.count({ where: { patientProfileId: profileId } }),
      observations: await prisma.observation.count({ where: { patientProfileId: profileId } }),
    });
    const before = await count();
    expect(before.reports).toBeGreaterThan(0);
    expect(before.observations).toBeGreaterThan(0);

    await backfillDiagnostics(prisma);
    await backfillObservations(prisma);

    expect(await count()).toEqual(before);
  }, 60000);

  it("reports counts only — nothing in the summary is row content", async () => {
    const summary = await backfillObservations(prisma);
    for (const value of Object.values(summary)) expect(typeof value).toBe("number");
  }, 30000);
});
