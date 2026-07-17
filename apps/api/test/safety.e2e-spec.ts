import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Stage 6 e2e: safety evaluation triggered by medication/allergy changes,
 * persisted findings queried from the latest evaluation only, and the
 * acknowledge/resolve action lifecycle. Requires the seeded catalog
 * (Metformin duplicate brands, Amoxicillin) from packages/database/src/seed.ts.
 */
describe("Safety e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000201";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, offline_mutations, medication_changes,
        medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  function addManual(token: string, profileId: string, name: string, isPrn = false) {
    return auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications")).send({
      enteredName: name,
      source: "manual",
      isPrn,
      instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: isPrn ? "SOS" : "OD" },
    });
  }

  let token: string;
  let profileId: string;

  it("signs in and creates a profile", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Safety Test", preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  it("flags an uncertain-normalization finding for a free-text medicine, never silently skipping it", async () => {
    await addManual(token, profileId, "Some unlisted tablet").expect(201);

    const findings = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/safety/findings"),
    ).expect(200);
    expect(findings.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: "uncertain_normalization", severity: "info" })]),
    );
  });

  it("flags exact ingredient duplication when two seeded brands share Metformin", async () => {
    const glycomet = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/catalog/products?q=Glycomet")).expect(200);
    const glyciphage = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/catalog/products?q=Glyciphage"),
    ).expect(200);

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        productId: glycomet.body.items[0].id,
        source: "search",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);
    const secondRes = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        productId: glyciphage.body.items[0].id,
        source: "search",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);

    const findings = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/safety/findings"),
    ).expect(200);
    const exact = findings.body.items.find((f: { category: string }) => f.category === "exact_ingredient_duplication");
    expect(exact).toBeTruthy();
    expect(exact.severity).toBe("high");
    expect(exact.medicationIds).toContain(secondRes.body.id);
    expect(exact.detail.ingredientName).toBe("Metformin");
  });

  it("flags a drug-allergy match when a recorded allergy names a seeded ingredient", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/allergies"))
      .send({ label: "Penicillin", severity: "severe" })
      .expect(201);

    const novamox = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/catalog/products?q=Novamox")).expect(200);
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        productId: novamox.body.items[0].id,
        source: "search",
        instruction: { doseQuantity: 1, doseUnit: "capsule", frequencyCode: "TDS" },
      })
      .expect(201);

    const findings = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/safety/findings"),
    ).expect(200);
    const allergy = findings.body.items.find((f: { category: string }) => f.category === "drug_allergy");
    expect(allergy).toBeTruthy();
    expect(allergy.severity).toBe("high");
    expect(allergy.detail.allergyLabel).toBe("Penicillin");
  });

  it("acknowledging a finding keeps it visible with the new status — it is never deleted", async () => {
    const findings = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/safety/findings"),
    ).expect(200);
    const target = findings.body.items.find((f: { category: string }) => f.category === "drug_allergy");

    const acked = await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/findings/${target.id}/actions`))
      .send({ action: "acknowledged" })
      .expect(201);
    expect(acked.body.status).toBe("acknowledged");

    const after = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/safety/findings"),
    ).expect(200);
    const stillThere = after.body.items.find((f: { id: string }) => f.id === target.id);
    expect(stillThere).toBeTruthy();
    expect(stillThere.status).toBe("acknowledged");

    const audits = await prisma.auditEvent.findMany({
      where: { patientProfileId: profileId, action: "finding.acknowledged" },
    });
    expect(audits.length).toBeGreaterThan(0);
  });

  it("ignores an allergy with no ingredient match instead of guessing", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/allergies"))
      .send({ label: "Something unusual I once reacted to", severity: "unknown" })
      .expect(201);
    const allergy = await prisma.patientAllergy.findFirst({ where: { label: "Something unusual I once reacted to" } });
    expect(allergy?.allergenIngredientId).toBeNull();
  });

  it("flags a schedule conflict when a fixed-frequency medicine loses its active schedule", async () => {
    const med = await addManual(token, profileId, "Schedule Gap Test").expect(201);
    await prisma.medicationSchedule.updateMany({
      where: { patientMedicationId: med.body.id },
      data: { status: "ended" },
    });

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/safety/evaluate")).expect(201);
    const findings = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/safety/findings"),
    ).expect(200);
    const conflict = findings.body.items.find(
      (f: { category: string; medicationIds: string[] }) => f.category === "schedule_conflict" && f.medicationIds.includes(med.body.id),
    );
    expect(conflict).toMatchObject({ severity: "moderate", explanationKey: "safety.explain.schedule_conflict_missing" });
  });

  it("flags a schedule conflict when a PRN medicine has an active schedule anyway", async () => {
    const med = await addManual(token, profileId, "PRN Schedule Test", true).expect(201);
    const schedule = await prisma.medicationSchedule.findFirst({ where: { patientMedicationId: med.body.id } });
    expect(schedule).toBeNull(); // PRN medicines get no schedule by default (docs/16)

    await prisma.medicationSchedule.create({
      data: {
        patientMedicationId: med.body.id,
        timezone: "Asia/Kolkata",
        slots: [{ slot: "morning", time: "08:00", quantity: 1 }],
        status: "active",
      },
    });

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/safety/evaluate")).expect(201);
    const findings = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/safety/findings"),
    ).expect(200);
    const conflict = findings.body.items.find(
      (f: { category: string; medicationIds: string[] }) => f.category === "schedule_conflict" && f.medicationIds.includes(med.body.id),
    );
    expect(conflict).toMatchObject({ severity: "low", explanationKey: "safety.explain.schedule_conflict_prn" });
  });

  it("flags dose-differs-from-prescription when the confirmed dose changes, and re-evaluates automatically on edit", async () => {
    const med = await addManual(token, profileId, "Dose Change Test").expect(201);
    const rowVersion = med.body.rowVersion;

    await auth(token, profileId)(request(app.getHttpServer()).patch(`/v1/medications/${med.body.id}`))
      .send({ rowVersion, instruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(200);

    // No manual /safety/evaluate call — editing the instruction must trigger it itself.
    const findings = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/safety/findings"),
    ).expect(200);
    const differs = findings.body.items.find(
      (f: { category: string; medicationIds: string[] }) => f.category === "dose_differs_from_prescription" && f.medicationIds.includes(med.body.id),
    );
    expect(differs).toMatchObject({ severity: "moderate" });
    expect(differs.detail).toMatchObject({ originalDoseQuantity: 1, currentDoseQuantity: 2 });
  });
});
