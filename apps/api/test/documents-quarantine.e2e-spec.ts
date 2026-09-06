import { resolve } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { hashPassword, newOpaqueToken, hashSessionToken } from "../src/common/crypto";
import { startWorker, stopWorker } from "./helpers/worker";

const OBJECT_STORAGE_ROOT = resolve(__dirname, "../.dev-data/object-storage");

/**
 * Malware quarantine end to end (docs_v2/06 P3-3, docs_v2/09 §2): a PDF whose signature is
 * valid — so the upload-time magic-byte check accepts it — but which carries a /JavaScript
 * action. The real worker's scan runs before OCR, quarantines the document, and from then
 * on the page is kept but never served: the document read returns no download URL, a link
 * minted before the verdict answers 410, the audit trail says why, and the admin funnel
 * counts it. No real malware is in the repository: the fixture is built here from text.
 */
const PDF_WITH_JAVASCRIPT = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert('hi')) >> >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >> endobj",
    "trailer << /Root 1 0 R >>",
    "%%EOF",
    "",
  ].join("\n"),
  "latin1",
);

describe("Document quarantine e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: ChildProcessWithoutNullStreams;

  const PHONE = "+919000000431";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, admin_sessions, admin_users, dead_letter_jobs, background_jobs,
        health_events, document_candidates, document_extractions, document_pages, patient_documents,
        stored_objects, sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    worker = await startWorker(OBJECT_STORAGE_ROOT);
  }, 120000);

  afterAll(async () => {
    stopWorker(worker);
    await app.close();
  });

  const auth = (req: request.Test) =>
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass").set("x-profile-id", profileId);

  let token: string;
  let profileId: string;
  let documentId: string;
  let downloadUrlBeforeVerdict: string;

  it("signs in and creates a one-page PDF document", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;
    const profile = await request(app.getHttpServer())
      .post("/v1/profiles")
      .set("authorization", `Bearer ${token}`)
      .set("x-requested-with", "medpass")
      .send({ displayName: "Quarantine Test", yearOfBirth: 1975, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;

    const created = await auth(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"))
      .send({ sourceChannel: "file", title: "Lab report", pages: [{ contentType: "application/pdf", sizeBytes: PDF_WITH_JAVASCRIPT.length }] })
      .expect(201);
    documentId = created.body.id;

    const uploadPath = (created.body.pages[0].uploadUrl as string).replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer()).put(uploadPath).set("content-type", "application/pdf").send(PDF_WITH_JAVASCRIPT).expect(200);
  });

  it("the upload-time signature check accepts it (it is a real PDF) and queues classification", async () => {
    const completed = await auth(request(app.getHttpServer()).post(`/v1/patient-documents/${documentId}/pages/1/complete`)).expect(201);
    expect(completed.body.status).toBe("processing");

    // A download link minted while the page was still "verified" — the pre-verdict link.
    const before = await auth(request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}`)).expect(200);
    expect(before.body.pages[0].status).toBe("verified");
    expect(before.body.pages[0].downloadUrl).toContain("/v1/dev-storage/");
    downloadUrlBeforeVerdict = before.body.pages[0].downloadUrl;
  });

  it("the worker's malware scan quarantines the document before any OCR runs", async () => {
    const deadline = Date.now() + 90_000;
    let body: { status: string } | undefined;
    while (Date.now() < deadline) {
      const res = await auth(request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}`)).expect(200);
      body = res.body;
      if (res.body.status === "quarantined") break;
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(body?.status).toBe("quarantined");

    const pages = await prisma.documentPage.findMany({ where: { documentId }, include: { storedObject: true } });
    expect(pages[0]?.storedObject.status).toBe("quarantined");
    // Kept, not deleted; and never OCR'd — no text object, no extraction job.
    expect(pages[0]?.ocrTextObjectId).toBeNull();
    expect(await prisma.backgroundJob.count({ where: { queue: "document_extract" } })).toBe(0);
    expect(await prisma.documentExtraction.count({ where: { documentId } })).toBe(0);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "document.quarantined", entityId: documentId } });
    expect(audit).not.toBeNull();
    expect(audit?.context).toMatchObject({ pageNumber: 1, engine: "magic-byte", reason: "pdf_active_content:/JavaScript" });
  }, 120000);

  it("a quarantined page is never served: no download URL, and the earlier link answers 410", async () => {
    const doc = await auth(request(app.getHttpServer()).get(`/v1/patient-documents/${documentId}`)).expect(200);
    expect(doc.body.pages[0].status).toBe("quarantined");
    expect(doc.body.pages[0].downloadUrl).toBeNull();

    const path = downloadUrlBeforeVerdict.replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer()).get(path).expect(410);
  });

  it("re-processing is refused while a page is quarantined", async () => {
    await auth(request(app.getHttpServer()).post(`/v1/patient-documents/${documentId}/process`)).send({}).expect(400);
  });

  it("the admin funnel counts the quarantine, by malware verdict", async () => {
    const admin = await prisma.adminUser.create({
      data: { email: "quarantine-ops@test.com", passwordHash: hashPassword("test-password-123"), duties: ["operations_view"] as never },
    });
    const sessionToken = newOpaqueToken();
    await prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashSessionToken(sessionToken),
        refreshTokenHash: hashSessionToken(newOpaqueToken()),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const res = await request(app.getHttpServer())
      .get("/v1/admin/documents/status?days=1")
      .set("Cookie", [`medpass_admin_session=${sessionToken}`])
      .expect(200);
    expect(res.body.quarantined).toBe(1);
    expect(res.body.malwareQuarantined).toBe(1);
  });
});
