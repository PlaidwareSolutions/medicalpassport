import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * docs/07 screen 26 (Missed-dose state): approved `missed_dose` content
 * shows on the timeline for a missed dose, exactly like it does on the
 * medicine detail screen (docs/07 screen 19) — and, critically, a
 * combination product's missed dose never shows its *ingredients'*
 * individual content, only its own product-keyed content (none exists yet
 * in this pass, so it must show the fallback) — the exact hazard the
 * ingredient/product split in `ClinicalContentLookupService` protects
 * against.
 */
describe("Missed-dose guidance e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000901";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, dose_events,
        scheduled_doses, medication_schedules, medication_changes,
        medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    // Shared seeded "Metformin" ingredient isn't covered by the TRUNCATE
    // above (not per-run-synthetic) — reset any clinical content a
    // previous run of this file (or another suite) left behind so this
    // suite stays rerunnable and isolated.
    const metformin = await prisma.medicationIngredient.findFirst({ where: { name: "Metformin" } });
    if (metformin) {
      await prisma.clinicalContent.updateMany({ where: { ingredientId: metformin.id }, data: { currentVersionId: null } });
      await prisma.clinicalContentVersion.deleteMany({ where: { content: { ingredientId: metformin.id } } });
      await prisma.clinicalContent.deleteMany({ where: { ingredientId: metformin.id } });
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

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
      .send({ displayName: "Missed Dose Guidance Test", yearOfBirth: 1970, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  it("shows approved missed_dose guidance for a single-ingredient medicine's missed dose", async () => {
    const search = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/catalog/products?q=Glycomet")).expect(200);
    const productId = search.body.items[0].id;

    const med = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({ productId, source: "search", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" } })
      .expect(201);

    const schedule = await prisma.medicationSchedule.findFirstOrThrow({ where: { patientMedicationId: med.body.id } });
    const dose = await prisma.scheduledDose.findFirstOrThrow({ where: { medicationScheduleId: schedule.id }, orderBy: { dueAt: "asc" } });
    await prisma.scheduledDose.update({ where: { id: dose.id }, data: { status: "missed" } });
    const dateStr = dose.dueAt.toISOString().slice(0, 10);

    const before = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${dateStr}`)).expect(200);
    const missedBefore = before.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === dose.id);
    expect(missedBefore.status).toBe("missed");
    expect(missedBefore.medication.missedDoseGuidance).toBeNull();

    const ingredient = await prisma.medicationIngredient.findFirstOrThrow({ where: { name: "Metformin" } });
    const content = await prisma.clinicalContent.upsert({
      where: { kind_ingredientId: { kind: "missed_dose", ingredientId: ingredient.id } },
      create: { kind: "missed_dose", ingredientId: ingredient.id },
      update: {},
    });
    const version = await prisma.clinicalContentVersion.create({
      data: {
        contentId: content.id,
        body: "If a dose of metformin is missed, take it as soon as remembered unless the next dose is due soon.",
        sourceKind: "daily_med",
        sourceCitation: "openFDA/DailyMed structured product label, set id e2e-missed-dose-test, fetched 2026-01-01",
        reviewStatus: "approved",
        decidedAt: new Date("2026-01-02"),
      },
    });
    await prisma.clinicalContent.update({ where: { id: content.id }, data: { currentVersionId: version.id } });

    const after = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${dateStr}`)).expect(200);
    const missedAfter = after.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === dose.id);
    expect(missedAfter.medication.missedDoseGuidance).not.toBeNull();
    expect(missedAfter.medication.missedDoseGuidance.text).toContain("missed");
    expect(missedAfter.medication.missedDoseGuidance.sourceCitation).toContain("e2e-missed-dose-test");
  });

  it("never shows a combination product's ingredients' individual missed_dose content — fallback only", async () => {
    // Telmisartan (one of Telma-AM's two ingredients) already has approved
    // missed_dose content from a prior run's backfill on shared dev data in
    // some environments — but this suite runs against a clean local DB, so
    // seed it explicitly to prove the negative case for real, not by luck.
    const telmisartan = await prisma.medicationIngredient.findFirstOrThrow({ where: { name: "Telmisartan" } });
    const ingredientContent = await prisma.clinicalContent.upsert({
      where: { kind_ingredientId: { kind: "missed_dose", ingredientId: telmisartan.id } },
      create: { kind: "missed_dose", ingredientId: telmisartan.id },
      update: {},
    });
    const ingredientVersion = await prisma.clinicalContentVersion.create({
      data: {
        contentId: ingredientContent.id,
        body: "Telmisartan-only missed dose text that must never leak into the combination product's timeline entry.",
        sourceKind: "daily_med",
        sourceCitation: "openFDA/DailyMed structured product label, set id e2e-telmisartan-only, fetched 2026-01-01",
        reviewStatus: "approved",
        decidedAt: new Date("2026-01-02"),
      },
    });
    await prisma.clinicalContent.update({ where: { id: ingredientContent.id }, data: { currentVersionId: ingredientVersion.id } });

    const search = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/catalog/products?q=Telma-AM")).expect(200);
    const productId = search.body.items[0].id;
    expect(search.body.items[0].isCombination).toBe(true);

    const med = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({ productId, source: "search", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(201);

    const schedule = await prisma.medicationSchedule.findFirstOrThrow({ where: { patientMedicationId: med.body.id } });
    const dose = await prisma.scheduledDose.findFirstOrThrow({ where: { medicationScheduleId: schedule.id }, orderBy: { dueAt: "asc" } });
    await prisma.scheduledDose.update({ where: { id: dose.id }, data: { status: "missed" } });
    const dateStr = dose.dueAt.toISOString().slice(0, 10);

    const res = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/profiles/current/timeline?date=${dateStr}`)).expect(200);
    const missed = res.body.items.find((i: { scheduledDoseId: string }) => i.scheduledDoseId === dose.id);
    expect(missed.status).toBe("missed");
    expect(missed.medication.missedDoseGuidance).toBeNull();
  });
});
