import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { stepUp } from "./helpers/step-up";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Diagnostics (docs_v2/04 §6, docs_v2/05 §6) — the V2 lab/imaging model that
 * succeeds `reports`. What these cover, in order of how much they would hurt
 * to get wrong:
 *
 *  - the trend never silently merges units, and never silently drops a point
 *    it cannot convert (hazard H-35/H-39);
 *  - `interpretation` is refused on a patient path rather than stored or
 *    quietly dropped (hazard H-25);
 *  - a correction supersedes instead of overwriting, so the value a doctor
 *    read last month is still exactly what they read;
 *  - the V1 `reports` endpoints keep their shapes and now dual-write the V2
 *    mirror, with exactly one timeline event per test, not two.
 */
describe("Diagnostics e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000861";
  const PHONE_B = "+919000000862";
  const PHONE_C = "+919000000863";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events,
        diagnostic_results, diagnostic_reports, observations, measurement_devices,
        report_values, medical_reports, prescriptions, practitioners,
        glucose_readings, blood_pressure_readings, weight_readings, checkup_records,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  async function signIn(phone: string): Promise<string> {
    await prisma.otpAttempt.deleteMany({});
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    return verify.body.token;
  }

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let profileA: string;
  let profileC: string;
  let reportId: string;
  let glucoseResultId: string;

  it("sets up a patient, a view_medications-only caregiver, and an unrelated patient", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Diagnostics Test", yearOfBirth: 1971, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    tokenB = await signIn(PHONE_B);
    await stepUp(app.getHttpServer(), tokenA); // ADR-V2-012
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: invite.body.id }).expect(201);

    tokenC = await signIn(PHONE_C);
    const other = await auth(tokenC)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Someone Else", yearOfBirth: 1990, preferredLocale: "en" })
      .expect(201);
    profileC = other.body.id;
  });

  // ───────────────────────── reports CRUD ─────────────────────────

  it("files a diagnostic report and lists it", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports"))
      .send({
        kind: "laboratory",
        category: "biochemistry",
        title: "Diabetic profile",
        facilityNameText: "Apollo Diagnostics",
        reportingPractitionerName: "Dr. Rao",
        testedAt: "2026-07-25",
        specimenCollectedAt: "2026-07-25T03:30:00.000Z",
      })
      .expect(201);
    reportId = created.body.id;
    expect(created.body).toMatchObject({
      kind: "laboratory",
      category: "biochemistry",
      title: "Diabetic profile",
      facilityNameText: "Apollo Diagnostics",
      reportingPractitionerName: "Dr. Rao",
      testedAt: "2026-07-25",
      status: "final",
      resultCount: 0,
    });

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/diagnostic-reports")).expect(200);
    expect(list.body.items.find((r: { id: string }) => r.id === reportId)).toMatchObject({ title: "Diabetic profile", resultCount: 0 });
  });

  it("files an imaging report with its modality and findings", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports"))
      .send({ kind: "imaging", title: "Chest X-ray PA", modality: "xray", bodySite: "chest", impressionText: "No active lung lesion" })
      .expect(201);
    expect(created.body).toMatchObject({ kind: "imaging", modality: "xray", bodySite: "chest", impressionText: "No active lung lesion" });

    const filtered = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/diagnostic-reports?kind=imaging")).expect(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].id).toBe(created.body.id);
  });

  it("rejects a report with no title — that's the one thing the record can't be without", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports")).send({ kind: "laboratory" }).expect(400);
  });

  it("corrects the report's own fields in place — the report is not the result", async () => {
    const updated = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/diagnostic-reports/${reportId}`))
      .send({ facilityNameText: "Apollo Diagnostics, Banjara Hills", status: "amended" })
      .expect(200);
    expect(updated.body).toMatchObject({ facilityNameText: "Apollo Diagnostics, Banjara Hills", status: "amended", title: "Diabetic profile" });
  });

  it("refuses client-set provenance (ADR-V2-002)", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports"))
      .send({ kind: "laboratory", title: "Forged", provenanceSource: "lab_imported" })
      .expect(400);
    expect(res.body.code).toBe("provenance_not_client_settable");
  });

  // ───────────────────────── results ─────────────────────────

  it("adds a result, resolving the LOINC code and canonical unit server-side", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "fasting_glucose", enteredValueText: "100", referenceText: "70 - 100", referenceLow: 70, referenceHigh: 100 })
      .expect(201);
    glucoseResultId = created.body.id;
    expect(created.body).toMatchObject({
      analyteKey: "fasting_glucose",
      label: "Fasting Blood Sugar (FBS)",
      loincCode: "1558-6",
      enteredValueText: "100",
      valueNumeric: "100",
      unit: "mg/dL",
      enteredUnit: null,
      referenceText: "70 - 100",
      sequence: 1,
      interpretation: null,
    });
  });

  it("converts an entered unit to the analyte's canonical unit at write time", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "fasting_glucose", enteredValueText: "5.5", enteredUnit: "mmol/L" })
      .expect(201);
    // 5.5 mmol/L × 18.0182 = 99.1001 mg/dL. Both the number the patient
    // typed and the unit they typed it in survive on the row.
    expect(created.body).toMatchObject({ enteredValueText: "5.5", enteredUnit: "mmol/L", unit: "mg/dL" });
    expect(Number(created.body.valueNumeric)).toBeCloseTo(99.1001, 3);
  });

  it("keeps a qualitative result as words rather than inventing a number for it", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "crp", enteredValueText: "Negative" })
      .expect(201);
    expect(created.body).toMatchObject({ enteredValueText: "Negative", valueText: "Negative", valueNumeric: null });
  });

  it("requires a label for an `other` result and refuses one on a named analyte", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "other", enteredValueText: "180" })
      .expect(400);
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "hba1c", enteredValueText: "7.4", analyteLabelText: "Sugar" })
      .expect(400);
    const ok = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "other", enteredValueText: "180", analyteLabelText: "Serum Ferritin" })
      .expect(201);
    expect(ok.body).toMatchObject({ analyteKey: "other", label: "Serum Ferritin", loincCode: null });
  });

  it("refuses an analyte the terminology layer does not know", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "definitely_not_a_test", enteredValueText: "1" })
      .expect(400);
    expect(res.body.code).toBe("validation_failed");
  });

  // ───────────────────────── interpretation (hazard H-25) ─────────────────────────

  it("refuses an interpretation from a patient — this app never decides normal/high/low", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "hba1c", enteredValueText: "9.1", interpretation: "critical_high" })
      .expect(400);
    expect(res.body.code).toBe("interpretation_not_client_settable");
    // Refused, not silently dropped: nothing was written.
    const rows = await prisma.diagnosticResult.findMany({ where: { diagnosticReportId: reportId, analyteKey: "hba1c" } });
    expect(rows).toHaveLength(0);
  });

  it("refuses an interpretation from a caregiver too — caregiver_entered is not a provider path", async () => {
    // Widen the existing grant to one that can actually write (edit_profile
    // is granted by `manage_profile`, never by `view_medications`).
    const relationship = await prisma.caregiverRelationship.findFirstOrThrow({ where: { patientProfileId: profileA, status: "active" } });
    const owner = await prisma.patientProfile.findUniqueOrThrow({ where: { id: profileA }, select: { ownerUserId: true } });
    await prisma.caregiverPermission.create({
      data: { caregiverRelationshipId: relationship.id, scope: "manage_profile", grantedByUserId: owner.ownerUserId },
    });

    const res = await auth(tokenB, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "tsh", enteredValueText: "6.2", interpretation: "high" })
      .expect(400);
    expect(res.body.code).toBe("interpretation_not_client_settable");

    // …and the same caregiver writing the same value *without* a flag is
    // accepted, so the refusal is about the flag, not about the caregiver.
    const ok = await auth(tokenB, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "tsh", enteredValueText: "6.2" })
      .expect(201);
    expect(ok.body).toMatchObject({ provenanceSource: "caregiver_entered", interpretation: null });
  });

  it("never computes an interpretation from the reference range it was given", async () => {
    // 140 mg/dL against a stored 70–100 range is plainly out of it. The app
    // stores the range for the reader and stays silent about what it means.
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "post_prandial_glucose", enteredValueText: "240", referenceLow: 70, referenceHigh: 140 })
      .expect(201);
    expect(created.body.interpretation).toBeNull();
  });

  // ───────────────────────── corrections ─────────────────────────

  it("corrects a result by superseding it — the original stays exactly as it was", async () => {
    const corrected = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/diagnostic-results/${glucoseResultId}`))
      .send({ enteredValueText: "108", correctionReason: "misread the printout" })
      .expect(200);
    expect(corrected.body.id).not.toBe(glucoseResultId);
    expect(corrected.body).toMatchObject({ analyteKey: "fasting_glucose", enteredValueText: "108", valueNumeric: "108", supersededById: null });

    const original = await prisma.diagnosticResult.findUniqueOrThrow({ where: { id: glucoseResultId } });
    expect(original.enteredValueText).toBe("100");
    expect(original.supersededById).toBe(corrected.body.id);

    // The report detail still shows both, so the history is legible; only
    // the live one is counted.
    const detail = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/diagnostic-reports/${reportId}`)).expect(200);
    const ids = detail.body.results.map((r: { id: string }) => r.id);
    expect(ids).toContain(glucoseResultId);
    expect(ids).toContain(corrected.body.id);
    glucoseResultId = corrected.body.id;
  });

  it("refuses to correct a row that has already been superseded", async () => {
    const original = await prisma.diagnosticResult.findFirst({ where: { supersededById: { not: null } } });
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/diagnostic-results/${original!.id}`))
      .send({ enteredValueText: "110" })
      .expect(409);
    expect(res.body.code).toBe("conflict_row_version");
  });

  it("excludes superseded rows from the cross-report result search", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/diagnostic-results?analyteKey=fasting_glucose")).expect(200);
    const values = res.body.items.map((r: { enteredValueText: string }) => r.enteredValueText);
    expect(values).toContain("108");
    expect(values).not.toContain("100");
  });

  // ───────────────────────── trends (hazard H-35/H-39) ─────────────────────────

  it("returns one series in the canonical unit, with mg/dL and mmol/L points on the same axis", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/trends/results/fasting_glucose")).expect(200);
    expect(res.body).toMatchObject({ analyteKey: "fasting_glucose", canonicalUnit: "mg/dL", loincCode: "1558-6" });
    expect(res.body.points).toHaveLength(2);
    for (const point of res.body.points) expect(point.unit).toBe("mg/dL");
    const values = res.body.points.map((p: { value: number }) => p.value).sort((a: number, b: number) => a - b);
    expect(values[0]).toBeCloseTo(99.1001, 3);
    expect(values[1]).toBe(108);
    expect(res.body.unconvertible).toHaveLength(0);
  });

  it("keeps points it cannot convert in their own list rather than folding them into the line", async () => {
    // A unit outside the analyte's table. Plotting it as mg/dL would be a
    // wrong clinical value; dropping it would be a lost one.
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "fasting_glucose", enteredValueText: "7.2", enteredUnit: "mg/L" })
      .expect(201);
    // A qualitative entry has no number to plot at all.
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "fasting_glucose", enteredValueText: "Not detected" })
      .expect(201);

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/trends/results/fasting_glucose")).expect(200);
    expect(res.body.points).toHaveLength(2);
    expect(res.body.unconvertible).toHaveLength(2);
    const reasons = res.body.unconvertible.map((u: { reason: string }) => u.reason).sort();
    expect(reasons).toEqual(["not_numeric", "unsupported_unit"]);
    // Every unconvertible point still carries what the patient typed, so the
    // UI can show it as text next to the chart instead of hiding it.
    for (const point of res.body.unconvertible) {
      expect(point.enteredValueText).toBeTruthy();
      expect(point.value).toBeUndefined();
    }
  });

  it("converts HbA1c's affine IFCC unit too, not just simple factors", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "hba1c", enteredValueText: "64", enteredUnit: "mmol/mol" })
      .expect(201);
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/trends/results/hba1c")).expect(200);
    expect(res.body.canonicalUnit).toBe("%");
    // NGSP % = 0.09148 × 64 + 2.152 = 8.007
    expect(res.body.points[0].value).toBeCloseTo(8.007, 2);
  });

  // ───────────────────────── terminology ─────────────────────────

  it("serves the analyte vocabulary without a session — it is a code table, not PHI", async () => {
    const res = await request(app.getHttpServer()).get("/v1/terminology/analytes").expect(200);
    const glucose = res.body.items.find((a: { key: string }) => a.key === "fasting_glucose");
    expect(glucose).toMatchObject({ loincCode: "1558-6", canonicalUnit: "mg/dL", display: "Fasting Blood Sugar (FBS)" });
    expect(glucose.allowedEnteredUnits.map((u: { unit: string }) => u.unit)).toContain("mmol/L");
    expect(JSON.stringify(res.body)).not.toContain("Diagnostics Test");
  });

  // ───────────────────────── access control ─────────────────────────

  it("hides another patient's report behind a 404 rather than a 403 (IDOR)", async () => {
    await auth(tokenC, profileC)(request(app.getHttpServer()).get(`/v1/diagnostic-reports/${reportId}`)).expect(404);
    await auth(tokenC, profileC)(request(app.getHttpServer()).patch(`/v1/diagnostic-results/${glucoseResultId}`)).send({ enteredValueText: "1" }).expect(404);
    await auth(tokenC, profileC)(request(app.getHttpServer()).delete(`/v1/diagnostic-reports/${reportId}`)).expect(404);
    // …and a foreign profile header the caller has no relationship with is
    // refused before any row is touched.
    await auth(tokenC, profileA)(request(app.getHttpServer()).get(`/v1/diagnostic-reports/${reportId}`)).expect(403);
  });

  it("lets a view_medications-only caregiver read the record but not write to it", async () => {
    // Narrow the grant back down to the read-only medication scope, which
    // grants view_profile but never edit_profile (PROFILE_SCOPE_GRANTS).
    const relationship = await prisma.caregiverRelationship.findFirstOrThrow({ where: { patientProfileId: profileA, status: "active" } });
    await prisma.caregiverPermission.updateMany({
      where: { caregiverRelationshipId: relationship.id, scope: "manage_profile" },
      data: { revokedAt: new Date() },
    });

    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/diagnostic-reports")).expect(200);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get(`/v1/diagnostic-reports/${reportId}`)).expect(200);
    await auth(tokenB, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports"))
      .send({ kind: "laboratory", title: "Not theirs to file" })
      .expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).delete(`/v1/diagnostic-reports/${reportId}`)).expect(403);
  });

  // ───────────────────────── timeline ─────────────────────────

  it("emits exactly one timeline event per V2 report, refreshed in place as results land", async () => {
    const events = await prisma.healthEvent.findMany({ where: { entityType: "diagnostic_report", entityId: reportId } });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("test_result");
    expect(events[0]!.supersededAt).toBeNull();
    const summary = events[0]!.summary as Record<string, unknown>;
    expect(summary.title).toBe("Diabetic profile");
    expect(Number(summary.resultCount)).toBeGreaterThan(0);
  });

  it("supersedes the timeline event when the report is deleted", async () => {
    const doomed = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports"))
      .send({ kind: "ecg", title: "Resting ECG" })
      .expect(201);
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/diagnostic-reports/${doomed.body.id}`)).expect(204);
    await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/diagnostic-reports/${doomed.body.id}`)).expect(404);
    const events = await prisma.healthEvent.findMany({ where: { entityType: "diagnostic_report", entityId: doomed.body.id } });
    expect(events).toHaveLength(1);
    expect(events[0]!.supersededAt).not.toBeNull();
  });

  // ───────────────────────── V1 dual-write parity ─────────────────────────

  describe("V1 reports keep working and now mirror into the V2 model", () => {
    let v1ReportId: string;
    let v1ValueId: string;

    it("returns the unchanged V1 response shape and creates the V2 twin", async () => {
      const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/reports"))
        .send({ kind: "blood_test", label: "Thyroid panel", facilityName: "Vijaya Diagnostics", testedAt: "2026-08-02" })
        .expect(201);
      v1ReportId = created.body.id;
      // The V1 contract is byte-for-byte what it was: same keys, same names.
      expect(created.body).toMatchObject({
        kind: "blood_test",
        label: "Thyroid panel",
        facilityName: "Vijaya Diagnostics",
        testedAt: "2026-08-02",
        documents: [],
        values: [],
      });
      expect(created.body).not.toHaveProperty("diagnosticReportId");

      const mirror = await prisma.diagnosticReport.findUnique({ where: { legacyMedicalReportId: v1ReportId } });
      expect(mirror).toMatchObject({
        kind: "laboratory",
        title: "Thyroid panel",
        facilityNameText: "Vijaya Diagnostics",
        provenanceSource: "user_entered",
        verification: "patient_confirmed",
      });
    });

    it("mirrors a V1 value, filling in the LOINC code and unit V1 never had", async () => {
      const value = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/reports/${v1ReportId}/values`))
        .send({ analyte: "tsh", enteredValue: "6.4", referenceText: "0.4 - 4.0" })
        .expect(201);
      v1ValueId = value.body.id;
      expect(value.body).toMatchObject({ analyte: "tsh", enteredValue: "6.4", numericValue: "6.4" });

      const mirror = await prisma.diagnosticResult.findUnique({ where: { legacyReportValueId: v1ValueId } });
      const parent = await prisma.diagnosticReport.findUniqueOrThrow({ where: { legacyMedicalReportId: v1ReportId } });
      expect(mirror).toMatchObject({
        diagnosticReportId: parent.id,
        analyteKey: "tsh",
        enteredValueText: "6.4",
        referenceText: "0.4 - 4.0",
      });
      expect(mirror!.valueNumeric!.toString()).toBe("6.4");
      expect(mirror!.unit).toBe("u[IU]/mL");
    });

    it("emits the timeline event exactly once, not once per model", async () => {
      const parent = await prisma.diagnosticReport.findUniqueOrThrow({ where: { legacyMedicalReportId: v1ReportId } });
      const v1Events = await prisma.healthEvent.findMany({ where: { entityType: "medical_report", entityId: v1ReportId } });
      const mirrorEvents = await prisma.healthEvent.findMany({ where: { entityType: "diagnostic_report", entityId: parent.id } });
      expect(v1Events).toHaveLength(1);
      expect(mirrorEvents).toHaveLength(0);
    });

    it("shows a V1-entered value on the V2 trend, so one history spans both models", async () => {
      const res = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/trends/results/tsh")).expect(200);
      expect(res.body.points.map((p: { value: number }) => p.value)).toContain(6.4);
    });

    it("soft-deletes the mirror when the V1 value is deleted", async () => {
      await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/report-values/${v1ValueId}`)).expect(204);
      const mirror = await prisma.diagnosticResult.findUniqueOrThrow({ where: { legacyReportValueId: v1ValueId } });
      expect(mirror.deletedAt).not.toBeNull();
    });

    it("soft-deletes the mirror when the V1 report is deleted", async () => {
      await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/reports/${v1ReportId}`)).expect(204);
      const mirror = await prisma.diagnosticReport.findUniqueOrThrow({ where: { legacyMedicalReportId: v1ReportId } });
      expect(mirror.deletedAt).not.toBeNull();
      // And it stops surfacing on the V2 side too.
      const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/diagnostic-reports")).expect(200);
      expect(list.body.items.map((r: { id: string }) => r.id)).not.toContain(mirror.id);
    });
  });
});
