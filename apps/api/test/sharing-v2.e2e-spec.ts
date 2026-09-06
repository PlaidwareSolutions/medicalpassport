import { SHARE_TOKEN_PEPPER } from "./helpers/share-pepper";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { stepUp } from "./helpers/step-up";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * V2 Phase 7 sharing (docs_v2/05 §9, docs_v2/04 §11, docs_v2/06 P7-1..P7-3):
 * new sections, audience, expiry presets, the Doctor Snapshot (own and
 * public), per-page document access through a share, and the peppered
 * token hash with the legacy bare-sha256 path still verifying. Runs with
 * SHARE_TOKEN_PEPPER set (helpers/share-pepper.ts); sharing.e2e-spec.ts
 * keeps covering the unpeppered V1 behaviour.
 */
describe("Sharing V2 e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000921";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
  const PAGE_1 = readFileSync(join(__dirname, "fixtures/prescription-page-1.png"));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, offline_mutations, dead_letter_jobs, background_jobs,
        share_access_events, share_links, share_packages,
        health_events, document_candidates, document_extractions, document_pages, patient_documents,
        extraction_candidates, prescription_extractions, prescription_documents,
        stored_objects, observations, medication_changes, medication_instructions, patient_medications,
        diagnostic_results, diagnostic_reports, report_values, medical_reports,
        prescription_items, prescriptions, encounters, immunizations, organizations,
        practitioners, patient_allergies, patient_conditions, consent_events,
        consents, caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  }, 60000);

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
  let documentId: string;
  let reportId: string;

  it("signs in and records medicines, an allergy, a condition, a lab result, a measurement, a visit and a document", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Sharing V2 Test", yearOfBirth: 1958, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/allergies"))
      .send({ label: "Sulfa drugs", severity: "severe" })
      .expect(201);
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/conditions"))
      .send({ label: "Type 2 diabetes" })
      .expect(201);
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({ enteredName: "Snapshot Test Metformin", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" } })
      .expect(201);

    const report = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/diagnostic-reports"))
      .send({ kind: "laboratory", title: "Quarterly panel", testedAt: "2026-09-01", facilityNameText: "Metro Labs" })
      .expect(201);
    reportId = report.body.id;
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/diagnostic-reports/${reportId}/results`))
      .send({ analyteKey: "hba1c", enteredValueText: "6.8", referenceText: "4.0 - 5.6" })
      .expect(201);

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/observations"))
      .send({ concept: "blood_pressure", valueNumeric: 128, valueNumeric2: 82, measuredAt: new Date().toISOString() })
      .expect(201);
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/encounters"))
      .send({ kind: "outpatient", startedAt: new Date().toISOString(), reasonText: "Quarterly review" })
      .expect(201);

    // One-page V2 document through the real presigned-upload flow (no worker: classification simply stays queued).
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/patient-documents"))
      .send({ sourceChannel: "camera", title: "Dr Sharma visit", pages: [{ contentType: "image/png", sizeBytes: PAGE_1.length }] })
      .expect(201);
    documentId = created.body.id;
    const uploadPath = (created.body.pages[0].uploadUrl as string).replace(/^https?:\/\/[^/]+/, "");
    await request(app.getHttpServer()).put(uploadPath).set("content-type", "image/png").send(PAGE_1).expect(200);
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/patient-documents/${documentId}/pages/1/complete`)).expect(201);
  }, 60000);

  it("builds the patient's own Doctor Snapshot: medicines, allergies, conditions, latest result per analyte with units, 30-day measurements, documents", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/doctor-snapshot")).expect(200);
    expect(res.body.currentMedications).toEqual([expect.objectContaining({ name: "Snapshot Test Metformin" })]);
    expect(res.body.allergies).toEqual([expect.objectContaining({ label: "Sulfa drugs", severity: "severe" })]);
    expect(res.body.majorConditions).toEqual([expect.objectContaining({ label: "Type 2 diabetes" })]);
    expect(res.body.latestResults).toEqual([
      expect.objectContaining({ analyteKey: "hba1c", label: expect.stringMatching(/HbA1c/i), value: "6.8", unit: "%", referenceText: "4.0 - 5.6", reportTitle: "Quarterly panel" }),
    ]);
    expect(res.body.measurements).toEqual([
      expect.objectContaining({ concept: "blood_pressure", unit: "mmHg", count: 1, latest: expect.objectContaining({ value: "128", value2: "82" }), average: "128", average2: "82" }),
    ]);
    expect(res.body.documents).toEqual([expect.objectContaining({ id: documentId, title: "Dr Sharma visit", pageCount: 1 })]);
    // Recent changes come from the timeline: the medicine start is there, and
    // nothing says who did it (H-33) — no actor fields, no caregiver_action.
    expect(res.body.recentChanges).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "medicine_started" })]));
    for (const change of res.body.recentChanges) {
      expect(change.actorType).toBeUndefined();
      expect(change.actorUserId).toBeUndefined();
      expect(change.kind).not.toBe("caregiver_action");
    }
  });

  let defaultToken: string;
  let defaultShareId: string;

  it("creates a share with an expiry preset and an audience; the default sections exclude documents", async () => {
    await stepUp(app.getHttpServer(), token);
    const before = Date.now();
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: {}, expiresIn: "15m", audience: "doctor" })
      .expect(201);
    defaultToken = created.body.token;
    defaultShareId = created.body.id;
    const expiresIn = new Date(created.body.expiresAt).getTime() - before;
    expect(expiresIn).toBeGreaterThan(14 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(15 * 60_000 + 5000);
    expect(created.body.audience).toBe("doctor");
    expect(created.body.sections).toMatchObject({ medications: true, measurements: true, encounters: true, conditions: true, documents: false, full_passport: false });

    const list = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/shares")).expect(200);
    const row = list.body.items.find((s: { id: string }) => s.id === defaultShareId);
    expect(row.audience).toBe("doctor");
    expect(row.sections.documents).toBe(false);
  });

  it("stores the token hash peppered — a bare sha256 of the token is not what is in the database", async () => {
    const link = await prisma.shareLink.findUniqueOrThrow({ where: { id: defaultShareId } });
    expect(link.tokenHash).toBe(sha256(SHARE_TOKEN_PEPPER + defaultToken));
    expect(link.tokenHash).not.toBe(sha256(defaultToken));
    expect(link.audience).toBe("doctor");
  });

  it("serves the summary and the snapshot publicly with the new sections, and never a document id on a share that did not choose documents", async () => {
    const summary = await request(app.getHttpServer()).get(`/v1/public/shares/${defaultToken}`).expect(200);
    expect(summary.body.measurements).toEqual([expect.objectContaining({ concept: "blood_pressure" })]);
    expect(summary.body.encounters).toEqual([expect.objectContaining({ kind: "outpatient", reasonText: "Quarterly review" })]);
    expect(summary.body.conditions).toEqual([expect.objectContaining({ label: "Type 2 diabetes" })]);
    expect(summary.body.documents).toBeUndefined();
    expect(JSON.stringify(summary.body)).not.toMatch(UUID_RE);

    const snapshot = await request(app.getHttpServer()).get(`/v1/public/shares/${defaultToken}/snapshot`).expect(200);
    expect(snapshot.headers["cache-control"]).toContain("no-store");
    expect(snapshot.body.latestResults).toEqual([expect.objectContaining({ analyteKey: "hba1c", value: "6.8", unit: "%" })]);
    expect(snapshot.body.measurements).toHaveLength(1);
    expect(snapshot.body.documents).toBeUndefined();
    expect(JSON.stringify(snapshot.body)).not.toMatch(UUID_RE);

    const log = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/shares/${defaultShareId}/accesses`)).expect(200);
    expect(log.body.items.map((i: { resource: string }) => i.resource).sort()).toEqual(["snapshot", "summary"]);
  });

  it("refuses page access on a share that did not choose documents — an indistinguishable 404, still logged", async () => {
    const res = await request(app.getHttpServer()).get(`/v1/public/shares/${defaultToken}/documents/${documentId}/pages/1`).expect(404);
    expect(res.body.title).toBe("This link is no longer available");

    const log = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/shares/${defaultShareId}/accesses`)).expect(200);
    expect(log.body.items[0]).toMatchObject({ result: "not_found", resource: "document_page", documentId, pageNumber: 1 });
  });

  let docsToken: string;
  let docsShareId: string;

  it("a share that chose documents lists them with ids and redirects a page request to a short-lived signed URL, logging every access", async () => {
    await stepUp(app.getHttpServer(), token);
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: { documents: true }, expiresIn: "7d", audience: "clinic" })
      .expect(201);
    docsToken = created.body.token;
    docsShareId = created.body.id;
    expect(new Date(created.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60_000);

    const summary = await request(app.getHttpServer()).get(`/v1/public/shares/${docsToken}`).expect(200);
    expect(summary.body.documents).toEqual([expect.objectContaining({ id: documentId, pageCount: 1 })]);

    const page = await request(app.getHttpServer()).get(`/v1/public/shares/${docsToken}/documents/${documentId}/pages/1`).expect(302);
    expect(page.headers.location).toContain("/v1/dev-storage/");
    expect(page.headers["cache-control"]).toContain("no-store");
    // The signed URL actually serves the page bytes.
    const bytes = await request(app.getHttpServer()).get((page.headers.location as string).replace(/^https?:\/\/[^/]+/, "")).expect(200);
    expect(Buffer.isBuffer(bytes.body) ? bytes.body.length : Number(bytes.headers["content-length"])).toBe(PAGE_1.length);

    // A page that does not exist, and a document that is not this patient's.
    await request(app.getHttpServer()).get(`/v1/public/shares/${docsToken}/documents/${documentId}/pages/99`).expect(404);
    await request(app.getHttpServer()).get(`/v1/public/shares/${docsToken}/documents/00000000-0000-4000-8000-000000000000/pages/1`).expect(404);
    await request(app.getHttpServer()).get(`/v1/public/shares/${docsToken}/documents/not-a-uuid/pages/1`).expect(404);

    const log = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/shares/${docsShareId}/accesses`)).expect(200);
    const pageEvents = log.body.items.filter((i: { resource: string }) => i.resource === "document_page");
    expect(pageEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ result: "success", documentId, pageNumber: 1 }),
        expect.objectContaining({ result: "not_found", documentId, pageNumber: 99 }),
        expect.objectContaining({ result: "not_found", pageNumber: 1 }),
      ]),
    );
    const audits = await prisma.auditEvent.findMany({ where: { entityType: "share_link", entityId: docsShareId, action: "share.accessed" } });
    expect(audits.some((a) => (a.context as { resource?: string }).resource === "document_page")).toBe(true);
  });

  it("full_passport expands to every section, documents included", async () => {
    await stepUp(app.getHttpServer(), token);
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: { full_passport: true, medications: false }, expiresIn: "1h" })
      .expect(201);
    expect(created.body.sections).toMatchObject({ full_passport: true, documents: true, medications: true, measurements: true, encounters: true });
    const pkg = await prisma.sharePackage.findFirstOrThrow({ where: { links: { some: { id: created.body.id } } } });
    expect((pkg.sections as { full_passport?: boolean }).full_passport).toBe(true);
  });

  it("accepts a custom expiresAt up to 30 days, prefers it over a preset, and refuses anything longer or in the past", async () => {
    await stepUp(app.getHttpServer(), token);
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60_000);
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: {}, expiresAt: inTwoDays.toISOString(), expiresIn: "15m" })
      .expect(201);
    expect(Math.abs(new Date(created.body.expiresAt).getTime() - inTwoDays.getTime())).toBeLessThan(1000);

    const tooLong = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: {}, expiresAt: new Date(Date.now() + 40 * 24 * 60 * 60_000).toISOString() })
      .expect(400);
    expect(tooLong.body.errors).toEqual([expect.objectContaining({ path: "expiresAt" })]);
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: {}, expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .expect(400);
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: {}, audience: "spouse" })
      .expect(400);
  });

  it("a link hashed the V1 way (bare sha256, minted before the pepper) still verifies", async () => {
    await prisma.shareLink.update({ where: { id: defaultShareId }, data: { tokenHash: sha256(defaultToken) } });
    const res = await request(app.getHttpServer()).get(`/v1/public/shares/${defaultToken}`).expect(200);
    expect(res.body.currentMedications).toHaveLength(1);
    // It is left as it was: the raw token is never rewritten into the peppered form on read.
    expect((await prisma.shareLink.findUniqueOrThrow({ where: { id: defaultShareId } })).tokenHash).toBe(sha256(defaultToken));
    // And a token that matches neither hash is still a 404.
    await request(app.getHttpServer()).get("/v1/public/shares/definitely-not-a-token").expect(404);
  });

  it("a share created before the V2 sections existed never starts exposing them — on the summary or the snapshot", async () => {
    await stepUp(app.getHttpServer(), token);
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: { documents: true }, expiresIn: "1h" })
      .expect(201);
    const link = await prisma.shareLink.findFirstOrThrow({ where: { id: created.body.id } });
    await prisma.sharePackage.update({
      where: { id: link.sharePackageId },
      data: { sections: { medications: true, allergies: true, conditions: true, recentChanges: true, concerns: true, reports: true } },
    });

    const summary = await request(app.getHttpServer()).get(`/v1/public/shares/${created.body.token}`).expect(200);
    expect(summary.body.currentMedications).toBeTruthy();
    expect(summary.body.measurements).toBeUndefined();
    expect(summary.body.documents).toBeUndefined();
    expect(summary.body.encounters).toBeUndefined();

    const snapshot = await request(app.getHttpServer()).get(`/v1/public/shares/${created.body.token}/snapshot`).expect(200);
    expect(snapshot.body.latestResults).toBeTruthy();
    expect(snapshot.body.measurements).toBeUndefined();
    expect(snapshot.body.documents).toBeUndefined();

    // Even though the link once carried documents, page access is closed now.
    await request(app.getHttpServer()).get(`/v1/public/shares/${created.body.token}/documents/${documentId}/pages/1`).expect(404);
  });

  it("revoking a documents share closes page access immediately", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/shares/${docsShareId}/revoke`)).expect(201);
    await request(app.getHttpServer()).get(`/v1/public/shares/${docsToken}/documents/${documentId}/pages/1`).expect(404);
    await request(app.getHttpServer()).get(`/v1/public/shares/${docsToken}/snapshot`).expect(404);
    const log = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/shares/${docsShareId}/accesses`)).expect(200);
    expect(log.body.items[0]).toMatchObject({ result: "revoked" });
  });

  it("the text export carries the new sections too, documents only when asked", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/visit-summary/text")).expect(200);
    expect(res.body.text).toContain("Home measurements (last 30 days)");
    expect(res.body.text).toContain("Blood pressure: latest 128/82 mmHg");
    expect(res.body.text).toContain("Visits (last 90 days)");
    expect(res.body.text).not.toContain("Documents on record");
    const withDocs = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/visit-summary/text?documents=true")).expect(200);
    expect(withDocs.body.text).toContain("Dr Sharma visit");
    expect(withDocs.body.text).not.toMatch(UUID_RE);
  });
});
