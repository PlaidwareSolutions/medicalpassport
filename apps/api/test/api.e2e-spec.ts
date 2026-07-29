import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { CLINICAL_CONTENT_KINDS } from "@medpass/domain";

/**
 * End-to-end flow against a real PostgreSQL (DATABASE_URL):
 * OTP → session → profile → medication CRUD → caregiver grant/use/revoke →
 * idempotency, rowVersion conflicts, OTP limits, audit rows.
 */
describe("API e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000001";
  const PHONE_B = "+919000000002";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    // Reset PHI tables so the suite is rerunnable (test databases only —
    // rate-limit state like otp_attempts persists across runs by design).
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, offline_mutations, medication_changes,
        medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    // This suite's content-enrichment tests use the shared, seeded
    // "Metformin" ingredient (not a per-run-synthetic row, so it isn't
    // covered by the TRUNCATE above) — reset any clinical content/jobs a
    // previous run of this same file left behind, so the suite stays
    // rerunnable rather than only passing once.
    const metformin = await prisma.medicationIngredient.findFirst({ where: { name: "Metformin" } });
    if (metformin) {
      await prisma.clinicalContent.updateMany({ where: { ingredientId: metformin.id }, data: { currentVersionId: null } });
      await prisma.clinicalContentTranslation.deleteMany({ where: { version: { content: { ingredientId: metformin.id } } } });
      await prisma.clinicalContentVersion.deleteMany({ where: { content: { ingredientId: metformin.id } } });
      await prisma.clinicalContent.deleteMany({ where: { ingredientId: metformin.id } });
      await prisma.backgroundJob.deleteMany({
        where: { jobKey: { in: CLINICAL_CONTENT_KINDS.map((kind) => `content-enrichment:${kind}:${metformin.id}`) } },
      });
    }

    // Same reset for the seed catalog's one real combination product
    // (Telma-AM = Telmisartan + Amlodipine), this time product-keyed.
    const telmaAm = await prisma.medicationBrand.findFirst({ where: { name: "Telma-AM" }, include: { products: true } });
    const telmaAmProduct = telmaAm?.products[0];
    if (telmaAmProduct) {
      await prisma.clinicalContent.updateMany({ where: { productId: telmaAmProduct.id }, data: { currentVersionId: null } });
      await prisma.clinicalContentTranslation.deleteMany({ where: { version: { content: { productId: telmaAmProduct.id } } } });
      await prisma.clinicalContentVersion.deleteMany({ where: { content: { productId: telmaAmProduct.id } } });
      await prisma.clinicalContent.deleteMany({ where: { productId: telmaAmProduct.id } });
      await prisma.backgroundJob.deleteMany({
        where: { jobKey: { in: CLINICAL_CONTENT_KINDS.map((kind) => `content-enrichment:${kind}:product:${telmaAmProduct.id}`) } },
      });
    }
  });

  afterAll(async () => {
    // This suite creates one real, per-run-uniquely-emailed AdminUser to
    // exercise the locale-translation-fallback test above (never covered by
    // the TRUNCATE above, which doesn't touch admin_users/PHI-adjacent
    // tables at all in this file) — clean it up so it doesn't accumulate.
    const translators = await prisma.adminUser.findMany({ where: { email: { startsWith: "e2e-locale-translator-" } }, select: { id: true } });
    const translatorIds = translators.map((t) => t.id);
    await prisma.clinicalContentTranslation.deleteMany({ where: { translatedByAdminUserId: { in: translatorIds } } });
    await prisma.adminUser.deleteMany({ where: { id: { in: translatorIds } } });
    await app.close();
  });

  async function signIn(phone: string): Promise<{ token: string }> {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const res = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser", label: "jest" } })
      .expect(201);
    expect(res.body.token).toBeTruthy();
    return { token: res.body.token };
  }

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  let tokenA: string;
  let tokenB: string;
  let profileA: string;
  let medicationId: string;
  let medicationRowVersion: number;

  it("serves health endpoints without auth", async () => {
    await request(app.getHttpServer()).get("/healthz").expect(200);
    const ready = await request(app.getHttpServer()).get("/readyz").expect(200);
    expect(ready.body.checks.postgres).toBe("ok");
  });

  it("exposes the configured OTP transport, unauthenticated, so the PWA can show accurate delivery wording", async () => {
    const res = await request(app.getHttpServer()).get("/v1/auth/otp-transport").expect(200);
    expect(res.body.transport).toBe(process.env.OTP_TRANSPORT ?? "log");
  });

  it("rejects unauthenticated PHI access and never publicly caches", async () => {
    const res = await request(app.getHttpServer()).get("/v1/profiles").expect(401);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.body.code).toBe("unauthenticated");
    expect(res.headers["x-correlation-id"]).toBeTruthy();
  });

  it("signs in with OTP (enumeration-safe request, fixed dev code)", async () => {
    ({ token: tokenA } = await signIn(PHONE_A));
  });

  it("rejects a wrong OTP and locks after repeated attempts", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE_B }).expect(202);
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post("/v1/auth/otp/verify")
        .send({ phone: PHONE_B, code: "999999", device: { kind: "browser" } });
      expect([400, 423]).toContain(res.status);
    }
    // Attempts exhausted: even the right code is refused now.
    const locked = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE_B, code: CODE, device: { kind: "browser" } });
    expect([400, 423]).toContain(locked.status);
  });

  it("enforces the OTP resend cooldown", async () => {
    const res = await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE_B });
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("otp_resend_limit");
  });

  it("creates a patient profile with a baseline consent and audit trail", async () => {
    const res = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Test Patient", yearOfBirth: 1958, preferredLocale: "te" })
      .expect(201);
    profileA = res.body.id;

    const consents = await prisma.consent.findMany({ where: { patientProfileId: profileA } });
    expect(consents.some((c) => c.type === "data_processing" && c.status === "active")).toBe(true);

    const audits = await prisma.auditEvent.findMany({ where: { patientProfileId: profileA } });
    expect(audits.some((a) => a.action === "profile.created")).toBe(true);
  });

  it("searches the seeded catalog", async () => {
    const res = await auth(tokenA)(request(app.getHttpServer()).get("/v1/catalog/products?q=metf")).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].ingredients[0].name).toBe("Metformin");
  });

  it("creates a medication from the catalog with an idempotency key", async () => {
    const search = await auth(tokenA)(request(app.getHttpServer()).get("/v1/catalog/products?q=Glycomet")).expect(200);
    const productId = search.body.items[0].id;
    const idempotencyKey = "11111111-1111-4111-8111-111111111111";
    const body = {
      productId,
      source: "search",
      patientReason: "Sugar control",
      prescriberName: "Dr. Rao",
      instruction: {
        doseQuantity: 1,
        doseUnit: "tablet",
        frequencyCode: "PATTERN",
        pattern: "1-0-1",
        foodInstruction: "after",
      },
    };

    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .set("idempotency-key", idempotencyKey)
      .send(body)
      .expect(201);
    medicationId = res.body.id;
    medicationRowVersion = res.body.rowVersion;
    expect(res.body.normalizationStatus).toBe("confirmed");
    expect(res.body.instruction.pattern).toBe("1-0-1");
    expect(res.body.patientReason).toBe("Sugar control");

    // Exact replay returns the same medication, not a duplicate.
    const replay = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .set("idempotency-key", idempotencyKey)
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(medicationId);
    const count = await prisma.patientMedication.count({ where: { patientProfileId: profileA, deletedAt: null } });
    expect(count).toBe(1);

    // Same key + different content is rejected.
    const mismatch = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .set("idempotency-key", idempotencyKey)
      .send({ ...body, patientReason: "Different" });
    expect(mismatch.status).toBe(409);
  });

  it("enqueues exactly one content-enrichment job per (ingredient, kind) pair, regardless of how many medications/patients reference it", async () => {
    const ingredient = await prisma.medicationIngredient.findFirstOrThrow({ where: { name: "Metformin" } });
    const jobKeys = CLINICAL_CONTENT_KINDS.map((kind) => `content-enrichment:${kind}:${ingredient.id}`);

    const firstJobs = await prisma.backgroundJob.findMany({ where: { jobKey: { in: jobKeys } } });
    expect(firstJobs).toHaveLength(CLINICAL_CONTENT_KINDS.length);
    expect(firstJobs.every((j) => j.queue === "content_enrichment")).toBe(true);
    expect(firstJobs.every((j) => (j.payload as { ingredientId: string }).ingredientId === ingredient.id)).toBe(true);

    // A second, unrelated medication referencing a different Metformin
    // product must not enqueue duplicate jobs for the same ingredient —
    // enrichment is cached per-(ingredient, kind), not per-medication/patient.
    const search = await auth(tokenA)(request(app.getHttpServer()).get("/v1/catalog/products?q=Glyciphage")).expect(200);
    const productId = search.body.items[0].id;
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({ productId, source: "search", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(201);

    const jobCount = await prisma.backgroundJob.count({ where: { jobKey: { in: jobKeys } } });
    expect(jobCount).toBe(CLINICAL_CONTENT_KINDS.length);
  });

  it("shows approved clinical content only once a reviewer has approved it for a single-ingredient medicine, never for an unreviewed kind", async () => {
    // Before any content is approved, the Metformin-based medicine (created
    // above) must show no clinical content at all — never fabricate.
    const before = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(before.body.clinicalContent).toEqual({});

    const ingredient = await prisma.medicationIngredient.findFirstOrThrow({ where: { name: "Metformin" } });
    const content = await prisma.clinicalContent.upsert({
      where: { kind_ingredientId: { kind: "education", ingredientId: ingredient.id } },
      create: { kind: "education", ingredientId: ingredient.id },
      update: {},
    });
    const version = await prisma.clinicalContentVersion.create({
      data: {
        contentId: content.id,
        body: "Metformin is commonly used to help control blood sugar in type 2 diabetes.",
        sourceKind: "daily_med",
        sourceCitation: "openFDA/DailyMed structured product label, set id e2e-test-set, fetched 2026-01-01",
        reviewStatus: "approved",
        decidedAt: new Date("2026-01-02"),
      },
    });
    await prisma.clinicalContent.update({ where: { id: content.id }, data: { currentVersionId: version.id } });

    const after = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(after.body.clinicalContent.education).toBeDefined();
    expect(after.body.clinicalContent.education.text).toContain("blood sugar");
    expect(after.body.clinicalContent.education.sourceCitation).toContain("e2e-test-set");
    expect(after.body.clinicalContent.education.lastReviewedAt).toContain("2026-01-02");
    // Only the approved kind (education) appears — the other 4 kinds remain unreviewed.
    expect(after.body.clinicalContent.storage).toBeUndefined();
    expect(after.body.clinicalContent.warningSymptoms).toBeUndefined();
    expect(after.body.clinicalContent.foodAlcohol).toBeUndefined();
    expect(after.body.clinicalContent.missedDose).toBeUndefined();
  });

  it("prefers an approved translation for the profile's own locale over the English body, and still falls back to English when no translation exists", async () => {
    // profileA was created above with preferredLocale: "te" (Telugu).
    const beforeTranslation = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(beforeTranslation.body.clinicalContent.education.text).toContain("blood sugar");
    expect(beforeTranslation.body.clinicalContent.education.locale).toBeUndefined();

    const ingredient = await prisma.medicationIngredient.findFirstOrThrow({ where: { name: "Metformin" } });
    const content = await prisma.clinicalContent.findUniqueOrThrow({ where: { kind_ingredientId: { kind: "education", ingredientId: ingredient.id } } });
    const version = await prisma.clinicalContentVersion.findUniqueOrThrow({ where: { id: content.currentVersionId! } });
    const translator = await prisma.adminUser.create({
      data: { email: `e2e-locale-translator-${Date.now()}@test.com`, passwordHash: "unused", duties: ["content_translate"] },
    });
    const translation = await prisma.clinicalContentTranslation.create({
      data: {
        versionId: version.id,
        locale: "te",
        body: "మధుమేహంలో రక్తంలో చక్కెరను నియంత్రించడానికి మెట్‌ఫార్మిన్ ఉపయోగించబడుతుంది.",
        translatedByAdminUserId: translator.id,
        reviewStatus: "approved",
        decidedByAdminUserId: translator.id,
        decidedAt: new Date(),
      },
    });

    const afterTranslation = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${medicationId}`)).expect(200);
    expect(afterTranslation.body.clinicalContent.education.text).toBe(translation.body);
    expect(afterTranslation.body.clinicalContent.education.locale).toBe("te");
    // Provenance (citation/reviewed date) still reflects the underlying English version, not the translation.
    expect(afterTranslation.body.clinicalContent.education.sourceCitation).toContain("e2e-test-set");
  });

  it("a combination-product medicine enqueues product-keyed jobs (not just per-ingredient ones), and only shows product-keyed approved content, never its ingredients' individual content", async () => {
    const search = await auth(tokenA)(request(app.getHttpServer()).get("/v1/catalog/products?q=Telma-AM")).expect(200);
    expect(search.body.items[0].isCombination).toBe(true);
    const productId = search.body.items[0].id;

    const med = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({ productId, source: "search", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(201);
    expect(med.body.clinicalContent).toEqual({});

    const productJobs = await prisma.backgroundJob.findMany({
      where: { jobKey: { in: CLINICAL_CONTENT_KINDS.map((kind) => `content-enrichment:${kind}:product:${productId}`) } },
    });
    expect(productJobs).toHaveLength(CLINICAL_CONTENT_KINDS.length);
    expect(productJobs.every((j) => (j.payload as { productId: string }).productId === productId)).toBe(true);

    // Approve product-keyed content...
    const content = await prisma.clinicalContent.upsert({
      where: { kind_productId: { kind: "education", productId } },
      create: { kind: "education", productId },
      update: {},
    });
    const version = await prisma.clinicalContentVersion.create({
      data: {
        contentId: content.id,
        body: "This fixed-dose combination is used to treat high blood pressure.",
        sourceKind: "daily_med",
        sourceCitation: "openFDA/DailyMed structured product label, set id e2e-combo-test, fetched 2026-01-01",
        reviewStatus: "approved",
        decidedAt: new Date("2026-01-02"),
      },
    });
    await prisma.clinicalContent.update({ where: { id: content.id }, data: { currentVersionId: version.id } });

    // ...and also approve one of its ingredients' own individual content, to
    // prove the medicine detail response never leaks that in instead.
    const telmisartan = await prisma.medicationIngredient.findFirstOrThrow({ where: { name: "Telmisartan" } });
    const ingredientContent = await prisma.clinicalContent.upsert({
      where: { kind_ingredientId: { kind: "education", ingredientId: telmisartan.id } },
      create: { kind: "education", ingredientId: telmisartan.id },
      update: {},
    });
    const ingredientVersion = await prisma.clinicalContentVersion.create({
      data: {
        contentId: ingredientContent.id,
        body: "Telmisartan-only text that must never leak into the combination product's response.",
        sourceKind: "daily_med",
        sourceCitation: "openFDA/DailyMed structured product label, set id e2e-telmisartan-only-2, fetched 2026-01-01",
        reviewStatus: "approved",
        decidedAt: new Date("2026-01-02"),
      },
    });
    await prisma.clinicalContent.update({ where: { id: ingredientContent.id }, data: { currentVersionId: ingredientVersion.id } });

    const after = await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/medications/${med.body.id}`)).expect(200);
    expect(after.body.clinicalContent.education.text).toContain("high blood pressure");
    expect(after.body.clinicalContent.education.sourceCitation).toContain("e2e-combo-test");
  });

  it("creates and edits a non-tablet medicine (e.g. a syrup dosed in ml)", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Test Syrup",
        source: "manual",
        instruction: { doseQuantity: 5, doseUnit: "ml", frequencyCode: "OD" },
      })
      .expect(201);
    expect(created.body.instruction.doseUnit).toBe("ml");
    expect(created.body.instruction.doseQuantity).toBe("5");

    const fetched = await auth(tokenA, profileA)(
      request(app.getHttpServer()).get(`/v1/medications/${created.body.id}`),
    ).expect(200);
    expect(fetched.body.instruction.doseUnit).toBe("ml");
    expect(fetched.body.instruction.doseQuantity).toBe("5");

    // Editing an unrelated field must not silently revert the unit back to
    // tablet (the exact bug this feature fixed on the frontend) — the
    // instruction is copy-on-write, so confirm the backend contract holds:
    // sending the same non-tablet unit through the update path persists it.
    const updated = await auth(tokenA, profileA)(
      request(app.getHttpServer()).patch(`/v1/medications/${created.body.id}`),
    )
      .send({
        rowVersion: created.body.rowVersion,
        instruction: { doseQuantity: 7.5, doseUnit: "ml", frequencyCode: "OD" },
      })
      .expect(200);

    const afterUpdate = await auth(tokenA, profileA)(
      request(app.getHttpServer()).get(`/v1/medications/${created.body.id}`),
    ).expect(200);
    expect(afterUpdate.body.instruction.doseUnit).toBe("ml");
    expect(afterUpdate.body.instruction.doseQuantity).toBe("7.5");
    expect(afterUpdate.body.rowVersion).toBe(updated.body.rowVersion);
  });

  it("rejects ambiguous SOS + pattern combinations (never silently interpret)", async () => {
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Painkiller",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "SOS", pattern: "1-0-1" },
      })
      .expect(400);
    expect(res.body.code).toBe("validation_failed");
  });

  it("enforces optimistic concurrency on medication updates", async () => {
    const stale = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medicationRowVersion + 99, patientReason: "Stale write" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("conflict_row_version");

    const ok = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medicationRowVersion, patientReason: "Updated reason" })
      .expect(200);
    medicationRowVersion = ok.body.rowVersion;
  });

  it("lets a patient add a doctor's name later if they forgot it when adding the medicine", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Forgot The Doctor Tablet",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);
    expect(created.body.prescriberName).toBeNull();

    const updated = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/medications/${created.body.id}`))
      .send({ rowVersion: created.body.rowVersion, prescriberName: "Dr. Iyer" })
      .expect(200);
    expect(updated.body.prescriberName).toBe("Dr. Iyer");

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/medications")).expect(200);
    const seen = list.body.items.find((m: { id: string }) => m.id === created.body.id);
    expect(seen.prescriberName).toBe("Dr. Iyer");
  });

  it("validates status transitions", async () => {
    const bad = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/medications/${medicationId}/status`))
      .send({ rowVersion: medicationRowVersion, status: "current" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("invalid_status_transition");

    const ok = await auth(tokenA, profileA)(request(app.getHttpServer()).post(`/v1/medications/${medicationId}/status`))
      .send({ rowVersion: medicationRowVersion, status: "paused", reason: "Doctor said pause before surgery" })
      .expect(201);
    medicationRowVersion = ok.body.rowVersion;
    expect(ok.body.status).toBe("paused");
  });

  it("grants caregiver access, enforces scopes server-side, and revokes immediately", async () => {
    // Re-sign B: clear OTP throttle state left by the lockout/cooldown tests
    // (equivalent to waiting out the resend cooldown).
    await prisma.otpAttempt.deleteMany({});
    ({ token: tokenB } = await signIn(PHONE_B));

    // A invites B with view-only scope, labelled to distinguish B from any
    // other caregiver sharing the same relationship (e.g. a second child).
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child", label: "Big Sister Aisha" })
      .expect(201);

    const listBeforeAccept = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregivers")).expect(200);
    const seenBeforeAccept = listBeforeAccept.body.items.find((i: { id: string }) => i.id === invite.body.id);
    expect(seenBeforeAccept.label).toBe("Big Sister Aisha");
    expect(seenBeforeAccept.status).toBe("invited");

    // B sees and accepts the invitation — the offered scopes must be visible
    // before accepting (informed consent, docs/23 E3.2), not accepted blind.
    const invitations = await auth(tokenB)(request(app.getHttpServer()).get("/v1/caregivers/invitations")).expect(200);
    const invitationSeen = invitations.body.items.find((i: { id: string }) => i.id === invite.body.id);
    expect(invitationSeen).toBeTruthy();
    expect(invitationSeen.scopes).toEqual(["view_medications"]);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept"))
      .send({ invitationId: invite.body.id })
      .expect(201);

    // B can view but not edit — enforcement is server-side.
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/medications")).expect(200);
    const denied = await auth(tokenB, profileA)(
      request(app.getHttpServer()).post("/v1/profiles/current/medications"),
    ).send({
      enteredName: "Not allowed",
      source: "manual",
      instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("caregiver_scope_missing");

    // Caregiver reads are audited.
    const audits = await prisma.auditEvent.findMany({
      where: { patientProfileId: profileA, action: "caregiver.access_used" },
    });
    expect(audits.length).toBeGreaterThan(0);

    // A can see B's access history — patient-visible access log (docs/23 E3.3).
    const accessLog = await auth(tokenA, profileA)(
      request(app.getHttpServer()).get(`/v1/caregivers/${invite.body.id}/accesses`),
    ).expect(200);
    expect(accessLog.body.items.length).toBeGreaterThan(0);
    expect(accessLog.body.items[0].accessedAt).toBeTruthy();

    // A can rename B later — e.g. realizing two caregivers share a
    // relationship and need distinct labels — without touching scopes.
    await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/caregivers/${invite.body.id}/scopes`))
      .send({ scopes: ["view_medications"], label: "Aisha (eldest)" })
      .expect(200);
    const listAfterRelabel = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/caregivers")).expect(200);
    const seenAfterRelabel = listAfterRelabel.body.items.find((i: { id: string }) => i.id === invite.body.id);
    expect(seenAfterRelabel.label).toBe("Aisha (eldest)");
    expect(seenAfterRelabel.status).toBe("active");

    // A revokes; B's next request fails immediately.
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/caregivers/${invite.body.id}`)).expect(204);
    const afterRevoke = await auth(tokenB, profileA)(
      request(app.getHttpServer()).get("/v1/profiles/current/medications"),
    );
    expect(afterRevoke.status).toBe(403);
  });

  it("keeps an append-only medication change history", async () => {
    const res = await auth(tokenA, profileA)(
      request(app.getHttpServer()).get(`/v1/medications/${medicationId}/history`),
    ).expect(200);
    const changes = res.body.items.map((c: { change: string }) => c.change);
    expect(changes).toEqual(expect.arrayContaining(["created", "updated", "status_changed"]));
  });

  it("revoked devices are rejected on the next request", async () => {
    const devices = await auth(tokenA)(request(app.getHttpServer()).get("/v1/auth/devices")).expect(200);
    const current = devices.body.items.find((d: { isCurrent: boolean }) => d.isCurrent);
    await auth(tokenA)(request(app.getHttpServer()).delete(`/v1/auth/devices/${current.id}`)).expect(204);
    const res = await auth(tokenA)(request(app.getHttpServer()).get("/v1/profiles"));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("session_revoked");
  });
});
