import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { terminateOcrWorker } from "../src/modules/extraction/ocr";

/**
 * Stage 3/8 e2e: presigned upload → signature verification → OCR → candidate
 * review/confirm → medication creation, plus the quarantine path for a file
 * whose bytes don't match its declared type. Requires the seeded catalog
 * (Glycomet 500mg tablet) from packages/database/src/seed.ts. Real OCR runs
 * against a committed synthetic test image — no mocking.
 */
describe("Documents & extraction e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000401";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
  const SAMPLE_IMAGE = readFileSync(join(__dirname, "fixtures/sample-prescription.png"));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, offline_mutations, extraction_candidates,
        prescription_extractions, prescription_documents, stored_objects,
        medication_changes, medication_instructions, patient_medications,
        practitioners, patient_allergies, patient_conditions, consent_events,
        consents, caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  }, 30000);

  afterAll(async () => {
    await terminateOcrWorker();
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
      .send({ displayName: "Documents Test", yearOfBirth: 1975, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  });

  let documentId: string;
  let extractionId: string;
  const candidateIdByField: Record<string, string> = {};

  it("authorizes an upload, stores the file, and verifies its signature", async () => {
    const authRes = await auth(token, profileId)(
      request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"),
    )
      .send({ kind: "prescription", contentType: "image/png", sizeBytes: SAMPLE_IMAGE.length })
      .expect(201);
    documentId = authRes.body.documentId;
    expect(authRes.body.uploadUrl).toContain("/v1/dev-storage/");

    const uploadPath = authRes.body.uploadUrl.replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer())
      .put(uploadPath)
      .set("content-type", "image/png")
      .send(SAMPLE_IMAGE)
      .expect(200);

    const completeRes = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/documents/${documentId}/complete`),
    ).expect(201);
    expect(completeRes.body.status).toBe("uploaded");

    const stored = await prisma.prescriptionDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { storedObject: true },
    });
    expect(stored.storedObject.status).toBe("verified");
    expect(stored.storedObject.sha256).toBeTruthy();
  });

  it("runs real OCR and proposes candidates from the exact detected text", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/documents/${documentId}/process`)).expect(
      201,
    );
    expect(res.body.status).toBe("processed");
    extractionId = res.body.extraction.id;

    const byField: Record<string, (typeof res.body.extraction.candidates)[number]> = {};
    for (const c of res.body.extraction.candidates) byField[c.field] = c;
    for (const id of Object.keys(byField)) candidateIdByField[id] = byField[id].id;

    expect(byField.brand_name.detectedText).toMatch(/glycomet/i);
    expect(byField.brand_name.proposedLabel).toMatch(/glycomet/i);
    expect(byField.brand_name.confidence).toBeGreaterThan(0.5);

    expect(byField.frequency.detectedText).toMatch(/1-0-1/);
    expect(byField.frequency.proposedValue).toBe("PATTERN:1-0-1");

    expect(byField.food_instruction.proposedValue).toBe("after");

    // Nothing is confirmed yet — the extraction never invents a fact.
    expect(Object.values(byField).every((c) => c.status === "proposed")).toBe(true);
  }, 30000);

  it("GET extraction returns the same candidates, resolved from storage", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/documents/${documentId}/extraction`)).expect(
      200,
    );
    expect(res.body.extraction.id).toBe(extractionId);
    expect(res.body.extraction.candidates).toHaveLength(3);
  });

  it("refuses to create a medication before the required fields are confirmed", async () => {
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/extractions/${extractionId}/create-medication`),
    )
      .send({ doseQuantity: 1, doseUnit: "tablet" })
      .expect(400);
    expect(res.body.title).toMatch(/confirm the medicine name/i);
  });

  it("confirms every candidate", async () => {
    const brand = await prisma.medicationProduct.findFirstOrThrow({ where: { brand: { name: "Glycomet" } } });

    await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/extraction-candidates/${candidateIdByField.brand_name}/confirm`),
    )
      .send({ confirmedValue: brand.id })
      .expect(201);
    await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/extraction-candidates/${candidateIdByField.frequency}/confirm`),
    )
      .send({ confirmedValue: "PATTERN:1-0-1" })
      .expect(201);
    await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/extraction-candidates/${candidateIdByField.food_instruction}/confirm`),
    )
      .send({ confirmedValue: "after" })
      .expect(201);

    const res = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/documents/${documentId}/extraction`)).expect(
      200,
    );
    expect(res.body.extraction.candidates.every((c: { status: string }) => c.status === "confirmed")).toBe(true);
  });

  it("creates a medication from the confirmed extraction — dose is always a typed pick, never OCR'd", async () => {
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/extractions/${extractionId}/create-medication`),
    )
      .set("idempotency-key", "22222222-2222-4222-8222-222222222222")
      .send({ doseQuantity: 1, doseUnit: "tablet" })
      .expect(201);

    expect(res.body.enteredName).toBe("Glycomet");
    expect(res.body.product.genericName).toBe("Metformin");
    expect(res.body.instruction).toEqual(
      expect.objectContaining({ frequencyCode: "PATTERN", pattern: "1-0-1", foodInstruction: "after", doseQuantity: "1" }),
    );
  });

  it("serves the verified file back through a fresh presigned download URL", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/documents/${documentId}/download-url`)).expect(
      200,
    );
    const downloadPath = res.body.url.replace(/^https?:\/\/[^/]+/, "");
    const fileRes = await request(app.getHttpServer()).get(downloadPath).expect(200);
    expect(Buffer.compare(fileRes.body, SAMPLE_IMAGE)).toBe(0);
  });

  it("recorded the full traceable audit trail with no raw PHI in context", async () => {
    const audits = await prisma.auditEvent.findMany({
      where: { patientProfileId: profileId },
      orderBy: { seq: "asc" },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "document.upload_authorized",
        "document.upload_completed",
        "extraction.processed",
        "extraction.field_confirmed",
        "medication.created",
        "document.downloaded",
      ]),
    );
    for (const a of audits) {
      expect(JSON.stringify(a.context ?? {})).not.toMatch(/glycomet/i);
    }
  });

  it("quarantines a file whose bytes don't match its declared type, and the quarantine persists", async () => {
    const fakeBytes = Buffer.from("this is not a real png file");
    const authRes = await auth(token, profileId)(
      request(app.getHttpServer()).post("/v1/profiles/current/documents/authorize-upload"),
    )
      .send({ kind: "prescription", contentType: "image/png", sizeBytes: fakeBytes.length })
      .expect(201);
    const badDocId = authRes.body.documentId;

    const uploadPath = authRes.body.uploadUrl.replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer()).put(uploadPath).set("content-type", "image/png").send(fakeBytes).expect(200);

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/documents/${badDocId}/complete`)).expect(400);

    // The 400 must not have rolled back the quarantine flag itself.
    const doc = await prisma.prescriptionDocument.findUniqueOrThrow({
      where: { id: badDocId },
      include: { storedObject: true },
    });
    expect(doc.status).toBe("quarantined");
    expect(doc.storedObject.status).toBe("quarantined");

    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: badDocId, action: "document.upload_completed" },
      orderBy: { seq: "desc" },
    });
    expect((audit?.context as { result?: string } | null)?.result).toBe("quarantined_signature_mismatch");
  });
});
