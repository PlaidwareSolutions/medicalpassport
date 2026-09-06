import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { startWorker, stopWorker } from "./helpers/worker";

const OBJECT_STORAGE_ROOT = resolve(__dirname, "../.dev-data/object-storage");

/**
 * Documents V2 end to end (docs_v2/05 §5, docs_v2/09): create a document with
 * two pages → presigned upload per page → magic-byte + sha256 verification →
 * the real apps/worker classifies and extracts → typed candidates → a person
 * confirms one and it becomes a medicine with OCR provenance, or rejects it
 * and nothing happens.
 *
 * The pages are committed synthetic prescriptions
 * (test/fixtures/prescription-page-{1,2}.png) rendered from plain text, not
 * real scans: OCR then behaves the same on every machine, and no patient's
 * document lives in the repository. The worker is the real binary claiming
 * jobs off the Postgres queue — no in-process shortcut.
 *
 * The rule this suite exists to protect is docs_v2/09 §1 rule 3: nothing
 * reaches a clinical table except through a confirmation.
 */
describe("Documents V2 e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: ChildProcessWithoutNullStreams;

  const PHONE = "+919000000411";
  const OTHER_PHONE = "+919000000412";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
  const PAGE_1 = readFileSync(join(__dirname, "fixtures/prescription-page-1.png"));
  const PAGE_2 = readFileSync(join(__dirname, "fixtures/prescription-page-2.png"));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, offline_mutations, dead_letter_jobs, background_jobs,
        health_events, document_candidates, document_extractions, document_pages, patient_documents,
        extraction_candidates, prescription_extractions, prescription_documents,
        stored_objects, medication_changes, medication_instructions, patient_medications,
        diagnostic_results, diagnostic_reports, report_values, medical_reports,
        prescription_items, prescriptions, immunizations, organizations,
        practitioners, patient_allergies, patient_conditions, consent_events,
        consents, caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    worker = await startWorker(OBJECT_STORAGE_ROOT);
  }, 120000);

  afterAll(async () => {
    stopWorker(worker);
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  async function signIn(phone: string, displayName: string) {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    const token: string = verify.body.token;
    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName, yearOfBirth: 1975, preferredLocale: "en" })
      .expect(201);
    return { token, profileId: profile.body.id as string };
  }

  /** Uploads bytes to a presigned URL and reports the page complete. */
  async function uploadPage(documentId: string, pageNumber: number, uploadUrl: string, bytes: Buffer) {
    const uploadPath = uploadUrl.replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer()).put(uploadPath).set("content-type", "image/png").send(bytes).expect(200);
    return auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/patient-documents/${documentId}/pages/${pageNumber}/complete`),
    ).expect(201);
  }

  async function waitForExtraction(documentId: string, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await auth(token, profileId)(
        request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}/extraction`),
      ).expect(200);
      if (res.body.extraction && ["succeeded", "failed"].includes(res.body.extraction.status)) return res.body;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`extraction for document ${documentId} did not complete within timeout`);
  }

  async function waitForClassification(documentId: string, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await auth(token, profileId)(
        request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}`),
      ).expect(200);
      if (res.body.classification.confidence !== null) return res.body;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`document ${documentId} was never classified`);
  }

  let token: string;
  let profileId: string;
  let otherToken: string;
  let otherProfileId: string;

  let documentId: string;
  let uploadUrls: string[] = [];
  let extractionId: string;
  type Candidate = {
    id: string;
    targetEntity: string;
    targetField: string;
    groupKey: string | null;
    pageNumber: number | null;
    boundingBox: unknown;
    detectedText: string;
    proposedValue: unknown;
    confidence: number;
    confidenceBucket: string;
    status: string;
  };
  let candidates: Candidate[] = [];
  const find = (entity: string, field: string) =>
    candidates.find((c) => c.targetEntity === entity && c.targetField === field)!;

  it("signs in two unrelated patients", async () => {
    ({ token, profileId } = await signIn(PHONE, "Documents V2"));
    ({ token: otherToken, profileId: otherProfileId } = await signIn(OTHER_PHONE, "Someone Else"));
    expect(profileId).not.toBe(otherProfileId);
  });

  it("creates a document and returns one upload authorization per page", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"))
      .send({
        sourceChannel: "camera",
        title: "Dr Sharma visit",
        pages: [
          { contentType: "image/png", sizeBytes: PAGE_1.length },
          { contentType: "image/png", sizeBytes: PAGE_2.length },
        ],
      })
      .expect(201);

    documentId = res.body.id;
    uploadUrls = res.body.pages.map((p: { uploadUrl: string }) => p.uploadUrl);
    expect(res.body.status).toBe("pending_upload");
    expect(res.body.pageCount).toBe(0);
    expect(res.body.pages).toHaveLength(2);
    expect(res.body.pages[0].pageNumber).toBe(1);
    expect(res.body.pages[1].pageNumber).toBe(2);
    expect(res.body.pages[0].uploadUrl).toContain("/v1/dev-storage/");
    // No kind was chosen, so the classifier is still free to decide.
    expect(res.body.classification.classifiedBy).toBeNull();
  });

  it("adds pages to an existing document later, and waits for them", async () => {
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"))
      .send({ pages: [{ contentType: "image/png", sizeBytes: PAGE_1.length }] })
      .expect(201);

    const more = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/patient-documents/${created.body.id}/pages/authorize-upload`),
    )
      .send({ pages: [{ contentType: "image/png", sizeBytes: PAGE_2.length }] })
      .expect(201);
    expect(more.body.pages).toEqual([expect.objectContaining({ pageNumber: 2 })]);

    const document = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/patient-documents/${created.body.id}`),
    ).expect(200);
    expect(document.body.pages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([1, 2]);
    // A document with a page still outstanding is not ready to classify.
    expect(document.body.status).toBe("pending_upload");
  });

  it("uploads and completes two pages, then enqueues classification", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}`)).expect(
      200,
    );
    expect(res.body.pages).toHaveLength(2);

    const first = await uploadPage(documentId, 1, uploadUrls[0]!, PAGE_1);
    // One page in, one to go: still waiting, and nothing is queued yet.
    expect(first.body.pageCount).toBe(1);
    expect(first.body.status).toBe("pending_upload");
    expect(await prisma.backgroundJob.count({ where: { queue: "document_classify" } })).toBe(0);

    const second = await uploadPage(documentId, 2, uploadUrls[1]!, PAGE_2);
    expect(second.body.pageCount).toBe(2);
    expect(second.body.status).toBe("processing");
    expect(await prisma.backgroundJob.count({ where: { queue: "document_classify" } })).toBe(1);

    const stored = await prisma.documentPage.findMany({
      where: { documentId },
      include: { storedObject: true },
      orderBy: { pageNumber: "asc" },
    });
    expect(stored.map((p) => p.storedObject.status)).toEqual(["verified", "verified"]);
    expect(stored.every((p) => p.storedObject.sha256)).toBe(true);
  }, 60000);

  it("the worker classifies the document and stores each page's text as its own object", async () => {
    const document = await waitForClassification(documentId);
    expect(document.classification.kind).toBe("prescription");
    expect(document.classification.classifiedBy).toBe("deterministic");
    expect(document.classification.confidence).toBeGreaterThan(0.5);
    expect(document.kind).toBe("prescription");

    const pages = await prisma.documentPage.findMany({ where: { documentId }, orderBy: { pageNumber: "asc" } });
    expect(pages.every((p) => p.ocrTextObjectId)).toBe(true);
    const textObjects = await prisma.storedObject.findMany({
      where: { id: { in: pages.map((p) => p.ocrTextObjectId!) } },
    });
    // Derived text lives in the 48 h bucket, never beside the original (docs_v2/09 §9).
    expect(textObjects.every((o) => o.bucket === "ocr_tmp")).toBe(true);
    expect(textObjects.every((o) => o.expiresAt !== null)).toBe(true);
  }, 120000);

  it("extracts typed candidates that each cite their page, box, confidence and bucket", async () => {
    const body = await waitForExtraction(documentId);
    expect(body.extraction.status).toBe("succeeded");
    expect(body.extraction.engine).toBe("deterministic-extractor");
    expect(body.extraction.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // Deterministic extraction claims no model — a false provenance record
    // would be worse than none (docs_v2/09 §8).
    expect(body.extraction.modelProvider).toBeNull();
    extractionId = body.extraction.id;

    candidates = body.extraction.groups.flatMap((g: { candidates: Candidate[] }) => g.candidates);
    expect(candidates.length).toBeGreaterThan(5);
    for (const candidate of candidates) {
      expect(candidate.pageNumber).toBeGreaterThan(0);
      expect(candidate).toHaveProperty("boundingBox");
      expect(candidate.confidence).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(candidate.confidenceBucket);
      // Nothing is auto-confirmed at any confidence (docs_v2/09 §6).
      expect(candidate.status).toBe("proposed");
    }

    const brand = find("medication", "brandName");
    expect(brand.detectedText).toMatch(/glycomet/i);
    expect(brand.proposedValue).toMatchObject({ label: "Glycomet" });
    expect(find("medication", "frequency").proposedValue).toEqual({ code: "PATTERN", pattern: "1-0-1" });
    expect(find("medication", "foodInstruction").proposedValue).toBe("after");
    expect(find("practitioner", "displayName").detectedText).toMatch(/sharma/i);
    expect(find("prescription", "prescribedAt").proposedValue).toBe("2026-03-12");

    // Fields the catalogue says are never auto-proposed never appear (H-02, H-35).
    expect(candidates.some((c) => c.targetField === "doseQuantity")).toBe(false);
    expect(candidates.some((c) => c.targetField === "interpretation")).toBe(false);

    // Page 2's medicine is its own group, attached to page 2 (H-36).
    const pageTwo = candidates.filter((c) => c.pageNumber === 2);
    expect(pageTwo.length).toBeGreaterThan(0);
    expect(new Set(candidates.map((c) => c.groupKey)).size).toBeGreaterThan(1);
  }, 120000);

  it("groups a medicine's fields together so the UI can show them against one crop", async () => {
    const body = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}/extraction`),
    ).expect(200);
    const medicationGroups = body.body.extraction.groups.filter(
      (g: { targetEntity: string }) => g.targetEntity === "medication",
    );
    expect(medicationGroups.length).toBe(2);
    const fields = medicationGroups[0].candidates.map((c: Candidate) => c.targetField);
    expect(fields).toEqual(expect.arrayContaining(["brandName", "frequency", "foodInstruction"]));
  });

  it("confirming fields one at a time writes nothing until the dose is typed", async () => {
    const frequency = find("medication", "frequency");
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/document-candidates/${frequency.id}/confirm`),
    )
      .send({})
      .expect(201);
    expect(res.body.status).toBe("confirmed");
    // H-02: no dose has been typed, so no medicine exists yet.
    expect(res.body.resultingEntityId).toBeNull();
    expect(await prisma.patientMedication.count({ where: { patientProfileId: profileId } })).toBe(0);
  });

  it("confirming the medicine name with a typed dose creates a PatientMedication with OCR provenance", async () => {
    const brand = find("medication", "brandName");
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/document-candidates/${brand.id}/confirm`),
    )
      .send({ medication: { doseQuantity: 1, doseUnit: "tablet" } })
      .expect(201);

    expect(res.body.resultingEntityType).toBe("patient_medication");
    const medicationId: string = res.body.resultingEntityId;
    expect(medicationId).toBeTruthy();

    const medication = await prisma.patientMedication.findUniqueOrThrow({
      where: { id: medicationId },
      include: { instructions: true },
    });
    expect(medication.enteredName).toBe("Glycomet");
    expect(medication.patientProfileId).toBe(profileId);
    // The whole point of the pipeline: this row knows it came off a photo,
    // that a person confirmed it, and exactly which document and run
    // (docs_v2/04 §7.5).
    expect(medication.provenanceSource).toBe("ocr_extracted");
    expect(medication.verification).toBe("patient_confirmed");
    expect(medication.sourceDocumentId).toBe(documentId);
    expect(medication.sourceExtractionId).toBe(extractionId);
    // The dose was typed, the frequency came off the page.
    expect(medication.instructions[0]?.doseQuantity.toString()).toBe("1");
    expect(medication.instructions[0]?.frequencyCode).toBe("PATTERN");
    expect(medication.instructions[0]?.pattern).toBe("1-0-1");

    // Every candidate in the group now points at what it became.
    const group = await prisma.documentCandidate.findMany({
      where: { extractionId, groupKey: brand.groupKey, status: { in: ["confirmed", "corrected"] } },
    });
    expect(group.every((c) => c.resultingEntityId === medicationId)).toBe(true);
  }, 60000);

  it("confirming another field of the same medicine joins the existing row rather than making a second one", async () => {
    const food = find("medication", "foodInstruction");
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/document-candidates/${food.id}/confirm`),
    )
      .send({ medication: { doseQuantity: 1, doseUnit: "tablet" } })
      .expect(201);
    expect(res.body.resultingEntityType).toBe("patient_medication");
    expect(await prisma.patientMedication.count({ where: { patientProfileId: profileId } })).toBe(1);
  });

  it("records a correction as the confirmed value, keeping the original proposal", async () => {
    const strength = find("medication", "strengthLabel");
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/document-candidates/${strength.id}/confirm`),
    )
      .send({ correctedValue: { value: "850", unit: "mg" } })
      .expect(201);
    expect(res.body.status).toBe("corrected");

    const row = await prisma.documentCandidate.findUniqueOrThrow({ where: { id: strength.id } });
    expect(row.correctedValue).toEqual({ value: "850", unit: "mg" });
    // docs_v2/09 §1 rule 2: the original is never destroyed by a correction.
    expect(row.proposedValue).toEqual({ value: "500", unit: "mg" });
  });

  it("refuses a correction that isn't a valid value for the target field", async () => {
    const duration = candidates.find((c) => c.targetField === "durationDays")!;
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/document-candidates/${duration.id}/confirm`),
    )
      .send({ correctedValue: "thirty" })
      .expect(400);
    expect(res.body.code).toBe("validation_failed");
  });

  it("rejects a candidate, and a rejected candidate can never be confirmed later", async () => {
    const page2Food = candidates.find((c) => c.pageNumber === 2 && c.targetField === "foodInstruction")!;
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/document-candidates/${page2Food.id}/reject`),
    )
      .send({})
      .expect(201);
    expect(res.body.status).toBe("rejected");

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/document-candidates/${page2Food.id}/confirm`))
      .send({})
      .expect(400);
    expect((await prisma.documentCandidate.findUniqueOrThrow({ where: { id: page2Food.id } })).resultingEntityId).toBeNull();
  });

  it("batch-materializes the prescription, its doctor and its clinic in one call", async () => {
    const ids = [
      find("prescription", "prescribedAt").id,
      find("practitioner", "displayName").id,
      find("practitioner", "registrationNumber").id,
      find("organization", "displayName").id,
    ];
    const res = await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/document-extractions/${extractionId}/materialize`),
    )
      .set("idempotency-key", randomUUID())
      .send({ candidateIds: ids })
      .expect(201);

    const created = res.body.created as Array<{ entityType: string; entityId: string }>;
    expect(created.map((c) => c.entityType).sort()).toEqual(["organization", "practitioner", "prescription"]);

    const prescription = await prisma.prescription.findFirstOrThrow({ where: { patientProfileId: profileId } });
    expect(prescription.prescribedAt?.toISOString().slice(0, 10)).toBe("2026-03-12");
    expect(prescription.provenanceSource).toBe("ocr_extracted");
    expect(prescription.verification).toBe("patient_confirmed");
    expect(prescription.sourceDocumentId).toBe(documentId);
    // The doctor read off the letterhead is attached to the prescription the
    // same batch created.
    expect(prescription.practitionerId).toBeTruthy();

    const practitioner = await prisma.practitioner.findUniqueOrThrow({ where: { id: prescription.practitionerId! } });
    expect(practitioner.displayName).toMatch(/sharma/i);
    expect(practitioner.registrationNumber).toBe("TSMC12345");

    // The document itself now points at the prescription it produced.
    const document = await prisma.patientDocument.findUniqueOrThrow({ where: { id: documentId } });
    expect(document.prescriptionId).toBe(prescription.id);
  }, 60000);

  it("a kind the patient chose survives classification (docs_v2/09 §4, H-34)", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"))
      .send({ kind: "discharge_summary", pages: [{ contentType: "image/png", sizeBytes: PAGE_1.length }] })
      .expect(201);
    const chosenId: string = res.body.id;
    expect(res.body.classification.classifiedBy).toBe("user");

    await uploadPage(chosenId, 1, res.body.pages[0].uploadUrl, PAGE_1);

    const deadline = Date.now() + 90000;
    let document;
    for (;;) {
      document = (
        await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/patient-documents/${chosenId}`)).expect(200)
      ).body;
      if (document.classification.confidence !== null) break;
      if (Date.now() > deadline) throw new Error("document was never classified");
      await new Promise((r) => setTimeout(r, 400));
    }

    // The classifier reads it as a prescription and says so, for the accuracy
    // metrics — and does not touch the kind the patient chose.
    expect(document.classification.kind).toBe("prescription");
    expect(document.kind).toBe("discharge_summary");
    expect(document.classification.classifiedBy).toBe("user");
  }, 120000);

  it("PATCH lets the patient override the kind, and the override outranks the classifier for good", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).patch(`/v1/patient-documents/${documentId}`))
      .send({ kind: "consultation_note", title: "Second opinion" })
      .expect(200);
    expect(res.body.kind).toBe("consultation_note");
    expect(res.body.classification.classifiedBy).toBe("user");
    // The classifier's own reading is still on file.
    expect(res.body.classification.kind).toBe("prescription");
    expect(res.body.title).toBe("Second opinion");
  });

  it("lists documents newest first with a cursor", async () => {
    const first = await auth(token, profileId)(
      request(app.getHttpServer()).get("/v1/profiles/current/patient-documents?limit=2"),
    ).expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/profiles/current/patient-documents?limit=2&cursor=${first.body.nextCursor}`),
    ).expect(200);
    const firstIds = first.body.items.map((i: { id: string }) => i.id);
    expect(second.body.items.every((i: { id: string }) => !firstIds.includes(i.id))).toBe(true);
  });

  it("serves each page through a short-lived download URL minted per request", async () => {
    const document = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}`),
    ).expect(200);
    expect(document.body.pages).toHaveLength(2);
    const url: string = document.body.pages[0].downloadUrl;
    expect(url).toBeTruthy();
    expect(new Date(document.body.pages[0].downloadUrlExpiresAt).getTime()).toBeGreaterThan(Date.now());

    const file = await request(app.getHttpServer()).get(url.replace(/^https?:\/\/[^/]+/, "")).expect(200);
    expect(Buffer.compare(file.body, PAGE_1)).toBe(0);
  });

  it("quarantines a page whose bytes don't match its declared type, and the quarantine persists", async () => {
    const fake = Buffer.from("this is not a real png file");
    const res = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"))
      .send({ pages: [{ contentType: "image/png", sizeBytes: fake.length }] })
      .expect(201);
    const badId: string = res.body.id;

    const uploadPath = res.body.pages[0].uploadUrl.replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer()).put(uploadPath).set("content-type", "image/png").send(fake).expect(200);
    await auth(token, profileId)(
      request(app.getHttpServer()).post(`/v1/patient-documents/${badId}/pages/1/complete`),
    ).expect(400);

    // The 400 must not have rolled the quarantine flag back.
    const document = await prisma.patientDocument.findUniqueOrThrow({
      where: { id: badId },
      include: { pages: { include: { storedObject: true } } },
    });
    expect(document.status).toBe("quarantined");
    expect(document.pages[0]!.storedObject.status).toBe("quarantined");
  });

  it("another patient's document is a 404, never a 403 — an id is not a hint (IDOR)", async () => {
    const paths = [
      `/v1/patient-documents/${documentId}`,
      `/v1/patient-documents/${documentId}/extraction`,
    ];
    for (const path of paths) {
      const res = await auth(otherToken, otherProfileId)(request(app.getHttpServer()).get(path)).expect(404);
      expect(res.body.code).toBe("not_found");
    }
    await auth(otherToken, otherProfileId)(request(app.getHttpServer()).patch(`/v1/patient-documents/${documentId}`))
      .send({ title: "mine now" })
      .expect(404);
    await auth(otherToken, otherProfileId)(
      request(app.getHttpServer()).delete(`/v1/patient-documents/${documentId}`),
    ).expect(404);
    await auth(otherToken, otherProfileId)(
      request(app.getHttpServer()).post(`/v1/document-candidates/${find("medication", "form").id}/confirm`),
    )
      .send({})
      .expect(404);
    await auth(otherToken, otherProfileId)(
      request(app.getHttpServer()).post(`/v1/document-extractions/${extractionId}/materialize`),
    )
      .set("idempotency-key", randomUUID())
      .send({ candidateIds: [find("medication", "form").id] })
      .expect(404);

    // Nothing leaked into the other patient's record.
    expect(await prisma.patientMedication.count({ where: { patientProfileId: otherProfileId } })).toBe(0);
  });

  it("soft-deletes the document, supersedes its timeline event, and keeps the originals", async () => {
    const before = await prisma.healthEvent.findMany({
      where: { entityType: "patient_document", entityId: documentId },
    });
    expect(before.length).toBeGreaterThan(0);
    expect(before.some((e) => e.supersededAt === null)).toBe(true);

    await auth(token, profileId)(request(app.getHttpServer()).delete(`/v1/patient-documents/${documentId}`)).expect(204);

    const after = await prisma.healthEvent.findMany({
      where: { entityType: "patient_document", entityId: documentId },
    });
    expect(after.every((e) => e.supersededAt !== null)).toBe(true);

    await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}`)).expect(404);

    // docs_v2/09 §1 rule 1: the original pages are still there — deletion of
    // the bytes is the retention policy's job, not this endpoint's.
    const pages = await prisma.documentPage.findMany({ where: { documentId }, include: { storedObject: true } });
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.storedObject.status === "verified")).toBe(true);
    // The medicine confirmed off it keeps its evidence link.
    const medication = await prisma.patientMedication.findFirstOrThrow({ where: { patientProfileId: profileId } });
    expect(medication.sourceDocumentId).toBe(documentId);
  });

  it("recorded a PHI-free audit trail for the whole pipeline", async () => {
    const audits = await prisma.auditEvent.findMany({ where: { patientProfileId: profileId }, orderBy: { seq: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "document.created",
        "document.page_completed",
        "document.classified",
        "extraction.processed",
        "extraction.candidate_confirmed",
        "extraction.candidate_rejected",
        "extraction.materialized",
        "document.updated",
        "document.deleted",
      ]),
    );
    for (const audit of audits) {
      expect(JSON.stringify(audit.context ?? {})).not.toMatch(/glycomet|sharma|sunrise|ecosprin/i);
    }
  });
});
