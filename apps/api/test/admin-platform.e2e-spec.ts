import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { awaitReadAudits } from "./helpers/audit";
import { encryptField, hashPassword, hashSessionToken, newOpaqueToken } from "../src/common/crypto";
import { generateTotpSecret } from "../src/common/totp";
import { BreakGlassService } from "../src/modules/admin-platform/break-glass.service";

/**
 * V2 admin platform (docs_v2/14 §3): duty gating per page, feature-flag
 * edits on the audit chain, support cases with opaque profile ids,
 * break-glass (reason, TOTP, time box, audit, patient notification), and
 * the read-only explorers. Every response is checked never to carry the
 * patient's display name.
 */
describe("Admin platform e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();
  const PATIENT_NAME = "Platform Fixture Patient Name";

  let superAdmin: string[];
  let auditor: string[];
  let support: string[];
  let ops: string[];
  let abdmOps: string[];
  let fhirViewer: string[];
  let noDuty: string[];
  let auditorId: string;
  let auditorTotpSecret: string;
  let profileId: string;
  let ownerUserId: string;

  const totpNow = (secret: string) =>
    new OTPAuth.TOTP({ issuer: "medpass admin", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) }).generate();

  async function createAdminWithSession(email: string, duties: string[], totpSecret?: string): Promise<{ cookies: string[]; adminId: string }> {
    const admin = await prisma.adminUser.create({
      data: {
        email,
        passwordHash: hashPassword("test-password-123"),
        duties: duties as never,
        ...(totpSecret ? { mfaSecretCiphertext: encryptField(totpSecret), mfaEnrolledAt: new Date() } : {}),
      },
    });
    const token = newOpaqueToken();
    await prisma.adminSession.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashSessionToken(token),
        refreshTokenHash: hashSessionToken(newOpaqueToken()),
        mfaVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return { cookies: [`medpass_admin_session=${token}`], adminId: admin.id };
  }

  const admin = (cookies: string[]) => (req: request.Test) => req.set("Cookie", cookies).set("x-requested-with", "medpass");

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, admin_sessions, admin_users, feature_flags,
        support_case_notes, support_cases, break_glass_grants, abdm_transactions, fhir_validation_failures,
        notification_attempts, notifications, notification_preferences, notification_channels,
        consent_events, consents, abdm_consent_artefacts, abha_links,
        document_candidates, document_extractions, document_pages, patient_documents, background_jobs,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    auditorTotpSecret = generateTotpSecret();
    superAdmin = (await createAdminWithSession("platform-super@test.com", ["super_admin"], generateTotpSecret())).cookies;
    const a = await createAdminWithSession("platform-auditor@test.com", ["audit_search"], auditorTotpSecret);
    auditor = a.cookies;
    auditorId = a.adminId;
    support = (await createAdminWithSession("platform-support@test.com", ["support_cases"])).cookies;
    ops = (await createAdminWithSession("platform-ops@test.com", ["operations_view"])).cookies;
    abdmOps = (await createAdminWithSession("platform-abdm@test.com", ["abdm_operations"])).cookies;
    fhirViewer = (await createAdminWithSession("platform-fhir@test.com", ["fhir_view"])).cookies;
    noDuty = (await createAdminWithSession("platform-none@test.com", [])).cookies;

    const user = await prisma.user.create({ data: { phoneDigest: `platform-${randomUUID()}`, phoneCiphertext: "unused" } });
    ownerUserId = user.id;
    const profile = await prisma.patientProfile.create({ data: { ownerUserId: user.id, displayName: PATIENT_NAME } });
    profileId = profile.id;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // ───────────────────────── Duty gating per page ─────────────────────────

  it("gates every page by exactly its documented duty", async () => {
    const pages: Array<{ path: string; allowed: string[][]; denied: string[][] }> = [
      { path: "/v1/admin/flags", allowed: [superAdmin], denied: [auditor, support, ops, abdmOps, fhirViewer, noDuty] },
      { path: "/v1/admin/support-cases", allowed: [support, superAdmin], denied: [auditor, ops, noDuty] },
      { path: "/v1/admin/break-glass", allowed: [auditor, superAdmin], denied: [support, ops, noDuty] },
      { path: `/v1/admin/consent-audit?profileId=${profileId}`, allowed: [auditor, superAdmin], denied: [support, ops, noDuty] },
      { path: "/v1/admin/documents/status", allowed: [ops, superAdmin], denied: [auditor, support, noDuty] },
      { path: "/v1/admin/abdm/transactions", allowed: [abdmOps, superAdmin], denied: [ops, auditor, noDuty] },
      { path: "/v1/admin/fhir/validation-failures", allowed: [fhirViewer, superAdmin], denied: [ops, abdmOps, noDuty] },
      { path: "/v1/admin/integrations", allowed: [ops, superAdmin], denied: [auditor, support, noDuty] },
      { path: "/v1/admin/notifications/failures", allowed: [ops, superAdmin], denied: [auditor, fhirViewer, noDuty] },
    ];
    for (const page of pages) {
      for (const cookies of page.allowed) await request(server()).get(page.path).set("Cookie", cookies).expect(200);
      for (const cookies of page.denied) {
        const res = await request(server()).get(page.path).set("Cookie", cookies).expect(403);
        expect(res.body.code).toBe("forbidden");
      }
    }
    await request(server()).get("/v1/admin/flags").expect(401);
  });

  // ───────────────────────── Feature flags ─────────────────────────

  it("lists static defaults, upserts a flag with an audit note, and meta/flags reflects it", async () => {
    const before = await admin(superAdmin)(request(server()).get("/v1/admin/flags")).expect(200);
    expect(before.body.items.map((i: { key: string; source: string }) => `${i.key}:${i.source}`).sort()).toEqual(
      ["aiExplanations:static", "prescriptionUpload:static", "safetyFindings:static", "sharing:static"],
    );

    const put = await admin(superAdmin)(request(server()).put("/v1/admin/flags/newTimeline"))
      .send({ description: "Unified health timeline", defaultOn: false, rolloutPercent: 25, allowProfileIds: [profileId], note: "Pilot cohort first" })
      .expect(200);
    expect(put.body).toMatchObject({ key: "newTimeline", defaultOn: false, rolloutPercent: 25, allowProfileIds: [profileId], source: "row" });

    const audit = await prisma.auditEvent.findFirst({ where: { action: "admin.flag_updated" }, orderBy: { seq: "desc" } });
    expect(audit?.actorType).toBe("admin");
    expect(audit?.context).toMatchObject({ key: "newTimeline", note: "Pilot cohort first", created: true, after: { rolloutPercent: 25, allowCount: 1 } });

    const flagsForProfile = await request(server()).get("/v1/meta/flags").set("x-profile-id", profileId).expect(200);
    expect(flagsForProfile.body.newTimeline).toBe(true);
    const flagsAnon = await request(server()).get("/v1/meta/flags").expect(200);
    expect(flagsAnon.body.newTimeline).toBe(false);

    await admin(superAdmin)(request(server()).put("/v1/admin/flags/newTimeline")).send({ defaultOn: true, note: "Everyone" }).expect(200);
    const again = await prisma.auditEvent.findFirst({ where: { action: "admin.flag_updated" }, orderBy: { seq: "desc" } });
    expect(again?.context).toMatchObject({ created: false, before: { defaultOn: false, rolloutPercent: 25 }, after: { defaultOn: true } });
    expect((await request(server()).get("/v1/meta/flags").expect(200)).body.newTimeline).toBe(true);

    const one = await admin(superAdmin)(request(server()).get("/v1/admin/flags/sharing")).expect(200);
    expect(one.body).toMatchObject({ key: "sharing", source: "static", defaultOn: false });
    await admin(superAdmin)(request(server()).get("/v1/admin/flags/nope")).expect(404);
    await admin(superAdmin)(request(server()).put("/v1/admin/flags/bad key")).send({ defaultOn: true, note: "x" }).expect(400);
    await admin(superAdmin)(request(server()).put("/v1/admin/flags/noNote")).send({ defaultOn: true }).expect(400);
    await admin(auditor)(request(server()).put("/v1/admin/flags/newTimeline")).send({ defaultOn: false, note: "not mine" }).expect(403);
  });

  // ───────────────────────── Support cases ─────────────────────────

  let caseId: string;

  it("opens, updates and annotates a support case; profile ids stay opaque", async () => {
    await admin(support)(request(server()).post("/v1/admin/support-cases")).send({ subject: "Cannot see reminders", patientProfileId: randomUUID() }).expect(404);

    const created = await admin(support)(request(server()).post("/v1/admin/support-cases"))
      .send({ subject: "Cannot see reminders", channel: "phone", patientProfileId: profileId })
      .expect(201);
    caseId = created.body.id;
    expect(created.body).toMatchObject({ subject: "Cannot see reminders", status: "open", channel: "phone", patientProfileId: profileId });

    await admin(support)(request(server()).post(`/v1/admin/support-cases/${caseId}/notes`)).send({ body: "Called back; asked to re-enable push." }).expect(201);
    const patched = await admin(support)(request(server()).patch(`/v1/admin/support-cases/${caseId}`)).send({ status: "waiting_on_patient" }).expect(200);
    expect(patched.body.status).toBe("waiting_on_patient");
    await admin(support)(request(server()).patch(`/v1/admin/support-cases/${caseId}`)).send({ status: "nope" }).expect(400);

    const detail = await admin(support)(request(server()).get(`/v1/admin/support-cases/${caseId}`)).expect(200);
    expect(detail.body.notes).toHaveLength(1);
    expect(detail.body.notes[0].body).toBe("Called back; asked to re-enable push.");
    expect(detail.body.breakGlassGrants).toEqual([]);
    expect(JSON.stringify(detail.body)).not.toContain(PATIENT_NAME);

    const list = await admin(support)(request(server()).get("/v1/admin/support-cases?status=waiting_on_patient")).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([caseId]);
    expect(list.body.totals).toEqual({ waiting_on_patient: 1 });
    expect(list.body.items[0].noteCount).toBe(1);
    expect((await admin(support)(request(server()).get("/v1/admin/support-cases?status=closed")).expect(200)).body.items).toEqual([]);

    const actions = await prisma.auditEvent.findMany({ where: { entityType: "support_case", entityId: caseId }, orderBy: { seq: "asc" } });
    expect(actions.map((a) => a.action)).toEqual(["admin.support_case_created", "admin.support_case_note_added", "admin.support_case_updated"]);
    expect(actions.every((a) => a.patientProfileId === profileId)).toBe(true);
    expect(actions.some((a) => JSON.stringify(a.context).includes("Called back"))).toBe(false);
  });

  // ───────────────────────── Break-glass ─────────────────────────

  let grantId: string;

  it("grants break-glass only with a reason, a valid TOTP and ≤ 60 minutes; audits it and notifies the patient", async () => {
    const base = { profileId, reason: "Support case: patient reports missing reminders", minutes: 30, supportCaseId: caseId };

    const badCode = await admin(auditor)(request(server()).post("/v1/admin/break-glass")).send({ ...base, totpCode: "000000" }).expect(403);
    expect(badCode.body.code).toBe("mfa_invalid");
    await admin(auditor)(request(server()).post("/v1/admin/break-glass")).send({ ...base, minutes: 61, totpCode: totpNow(auditorTotpSecret) }).expect(400);
    await admin(auditor)(request(server()).post("/v1/admin/break-glass")).send({ ...base, reason: "short", totpCode: totpNow(auditorTotpSecret) }).expect(400);
    await admin(support)(request(server()).post("/v1/admin/break-glass")).send({ ...base, totpCode: "123456" }).expect(403);
    expect(await prisma.breakGlassGrant.count()).toBe(0);
    expect(await prisma.notification.count({ where: { kind: "system" } })).toBe(0);

    const granted = await admin(auditor)(request(server()).post("/v1/admin/break-glass")).send({ ...base, totpCode: totpNow(auditorTotpSecret) }).expect(201);
    grantId = granted.body.id;
    expect(granted.body).toMatchObject({ adminUserId: auditorId, patientProfileId: profileId, reason: base.reason, supportCaseId: caseId, active: true, revokedAt: null });
    expect(granted.body.patientNotifiedAt).toBeTruthy();
    expect(new Date(granted.body.expiresAt).getTime() - new Date(granted.body.grantedAt).getTime()).toBe(30 * 60_000);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "admin.break_glass_granted" } });
    expect(audit).toMatchObject({ actorUserId: auditorId, actorType: "admin", entityType: "break_glass_grant", entityId: grantId, patientProfileId: profileId });
    expect(audit?.context).toMatchObject({ reason: base.reason, minutes: 30, supportCaseId: caseId });

    const notice = await prisma.notification.findUnique({ where: { dedupeKey: `break_glass:${grantId}` } });
    expect(notice).toMatchObject({ kind: "system", status: "pending", patientProfileId: profileId, privacyMode: "generic" });
  });

  it("the break-glass log lists the grant (audited read); the support case shows it; assertActive is the only check", async () => {
    const list = await admin(auditor)(request(server()).get("/v1/admin/break-glass?active=true")).expect(200);
    expect(list.body.items.map((g: { id: string }) => g.id)).toEqual([grantId]);
    expect((await admin(auditor)(request(server()).get("/v1/admin/break-glass?active=false")).expect(200)).body.items).toEqual([]);
    expect(JSON.stringify(list.body)).not.toContain(PATIENT_NAME);
    // Two reads here plus the one the duty-gating walk made earlier.
    await awaitReadAudits();
    expect(await prisma.auditEvent.count({ where: { action: "admin.break_glass_listed", actorUserId: auditorId } })).toBe(3);

    const detail = await admin(support)(request(server()).get(`/v1/admin/support-cases/${caseId}`)).expect(200);
    expect(detail.body.breakGlassGrants).toHaveLength(1);
    expect(detail.body.breakGlassGrants[0]).toMatchObject({ id: grantId, active: true });

    const service = app.get(BreakGlassService);
    await expect(service.assertActive(auditorId, profileId)).resolves.toMatchObject({ id: grantId });
    await expect(service.assertActive(randomUUID(), profileId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.assertActive(auditorId, randomUUID())).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.assertActive(auditorId, profileId, new Date(Date.now() + 31 * 60_000))).rejects.toMatchObject({ code: "forbidden" });

    await prisma.breakGlassGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
    await expect(service.assertActive(auditorId, profileId)).rejects.toMatchObject({ code: "forbidden" });
  });

  // ───────────────────────── Consent audit ─────────────────────────

  it("returns the consent timeline for an opaque profile id, audited, without scope or context", async () => {
    const consent = await prisma.consent.create({
      data: {
        patientProfileId: profileId,
        type: "sms_reminders",
        purpose: "Dose reminders by SMS",
        scope: { secret: "never-shown" },
        events: {
          create: [
            { event: "granted", actorUserId: ownerUserId, context: { ip: "never-shown" } },
            { event: "revoked", actorUserId: ownerUserId, occurredAt: new Date(Date.now() + 1000) },
          ],
        },
      },
    });
    const link = await prisma.abhaLink.create({ data: { patientProfileId: profileId, abhaNumberCiphertext: "x", abhaNumberDigest: `d-${randomUUID()}` } });
    await prisma.abdmConsentArtefact.create({ data: { abhaLinkId: link.id, purposeCode: "CAREMGT", hiTypes: ["Prescription"], status: "granted", grantedAt: new Date() } });

    const res = await admin(auditor)(request(server()).get(`/v1/admin/consent-audit?profileId=${profileId}`)).expect(200);
    expect(res.body.consents).toHaveLength(1);
    expect(res.body.consents[0]).toMatchObject({ id: consent.id, type: "sms_reminders", status: "active" });
    expect(res.body.consents[0].events.map((e: { event: string }) => e.event)).toEqual(["granted", "revoked"]);
    expect(res.body.abdmConsents).toHaveLength(1);
    expect(res.body.abdmConsents[0]).toMatchObject({ purposeCode: "CAREMGT", status: "granted", hiTypes: ["Prescription"] });
    expect(res.body.timeline.map((t: { source: string; event: string }) => `${t.source}:${t.event}`)).toEqual(
      expect.arrayContaining(["consent:granted", "consent:revoked", "abdm:requested", "abdm:granted"]),
    );
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("never-shown");
    expect(text).not.toContain(PATIENT_NAME);

    await admin(auditor)(request(server()).get(`/v1/admin/consent-audit?profileId=${randomUUID()}`)).expect(404);
    await admin(auditor)(request(server()).get("/v1/admin/consent-audit")).expect(400);
    await awaitReadAudits();
    const audit = await prisma.auditEvent.findFirst({ where: { action: "admin.consent_audit_viewed" } });
    expect(audit).toMatchObject({ actorUserId: auditorId, patientProfileId: profileId });
  });

  // ───────────────────────── Explorers ─────────────────────────

  it("document processing funnel counts stages and failures by engine — counts only", async () => {
    const doc = await prisma.patientDocument.create({
      data: { patientProfileId: profileId, title: "Secret Report Title", status: "processed", classification: "lab_report", classifiedBy: "deterministic", pageCount: 1 },
    });
    const ok = await prisma.documentExtraction.create({ data: { documentId: doc.id, engine: "deterministic", engineVersion: "1.2.0", status: "succeeded" } });
    await prisma.documentExtraction.create({ data: { documentId: doc.id, engine: "tesseract.js", engineVersion: "5.1.0", status: "failed", errorDigest: "boom" } });
    await prisma.documentCandidate.create({
      data: { extractionId: ok.id, patientProfileId: profileId, targetEntity: "diagnostic_result", targetField: "value", detectedText: "Secret Value 123", confidence: 0.9, status: "confirmed" },
    });
    await prisma.patientDocument.create({ data: { patientProfileId: profileId, status: "uploaded", pageCount: 1 } });

    const res = await admin(ops)(request(server()).get("/v1/admin/documents/status?days=7")).expect(200);
    expect(res.body.funnel).toEqual({ uploaded: 2, classified: 1, extracted: 1, confirmed: 1 });
    expect(res.body.failuresByEngine).toEqual([{ engine: "tesseract.js", engineVersion: "5.1.0", count: 1 }]);
    expect(res.body.byClassifiedBy).toEqual({ deterministic: 1 });
    expect(res.body.candidatesByStatus).toEqual({ confirmed: 1 });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("Secret");
    expect(text).not.toContain(profileId);
  });

  it("ABDM transaction explorer filters by status / errors and pages by cursor", async () => {
    await prisma.abdmTransaction.createMany({
      data: [
        { patientProfileId: profileId, kind: "consent.request", direction: "outbound", status: "completed", completedAt: new Date() },
        { patientProfileId: profileId, kind: "consent.request", direction: "outbound", status: "failed", errorCode: "ABDM-1001", errorText: "Gateway timeout" },
        { kind: "health-information.transfer", direction: "inbound", status: "completed", completedAt: new Date() },
      ],
    });
    const all = await admin(abdmOps)(request(server()).get("/v1/admin/abdm/transactions?limit=2")).expect(200);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.nextCursor).toBeTruthy();
    expect(all.body.totals.byStatus).toEqual({ completed: 2, failed: 1 });
    const rest = await admin(abdmOps)(request(server()).get(`/v1/admin/abdm/transactions?limit=2&cursor=${all.body.nextCursor}`)).expect(200);
    expect(rest.body.items).toHaveLength(1);
    expect(rest.body.nextCursor).toBeNull();

    const errors = await admin(abdmOps)(request(server()).get("/v1/admin/abdm/transactions?errorsOnly=true")).expect(200);
    expect(errors.body.items).toHaveLength(1);
    expect(errors.body.items[0]).toMatchObject({ errorCode: "ABDM-1001", status: "failed" });
    expect((await admin(abdmOps)(request(server()).get("/v1/admin/abdm/transactions?status=completed&direction=inbound")).expect(200)).body.items).toHaveLength(1);
    expect(JSON.stringify(all.body)).not.toContain(PATIENT_NAME);
  });

  it("FHIR validation failures list with totals", async () => {
    await prisma.fhirValidationFailure.createMany({
      data: [
        { direction: "outbound", igVersion: "6.5.0", resourceType: "Observation", path: "Observation.code", severity: "error", message: "Missing required element" },
        { direction: "inbound", igVersion: "7.0.0", resourceType: "MedicationRequest", path: "MedicationRequest.subject", severity: "warning", message: "Reference not resolved" },
      ],
    });
    const res = await admin(fhirViewer)(request(server()).get("/v1/admin/fhir/validation-failures")).expect(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.totals.bySeverity).toEqual({ error: 1, warning: 1 });
    const only = await admin(fhirViewer)(request(server()).get("/v1/admin/fhir/validation-failures?direction=inbound")).expect(200);
    expect(only.body.items).toHaveLength(1);
    expect(only.body.items[0].resourceType).toBe("MedicationRequest");
  });

  it("integrations report adapter health with last-success timestamps from BackgroundJob rows", async () => {
    const done = new Date();
    await prisma.backgroundJob.create({ data: { queue: "document_classify", jobKey: `platform-${randomUUID()}`, payload: {}, status: "succeeded", completedAt: done } });
    const res = await admin(ops)(request(server()).get("/v1/admin/integrations")).expect(200);
    const byKey = Object.fromEntries(res.body.items.map((i: { key: string }) => [i.key, i]));
    expect(byKey.classifier).toMatchObject({ health: "configured", lastSuccessAt: done.toISOString(), lastSuccessSource: "background_jobs" });
    expect(byKey.extractor.version).toBe("deterministic@1.2.0");
    expect(byKey.interaction_provider.health).toBe("not_configured");
    expect(byKey.whatsapp_bsp.health).toBe("not_configured");
    expect(byKey.lab_apis.health).toBe("none");
    expect(byKey.email.health).toBe("mock");
    expect(byKey.catalog.version).toBe("v1");
    expect(byKey.abdm_gateway.version).toBe("mock");
    expect(JSON.stringify(res.body)).not.toMatch(/api[_-]?key|secret/i);
  });

  it("notification failures aggregate by channel and kind over the window", async () => {
    const n = await prisma.notification.create({ data: { patientProfileId: profileId, kind: "refill", privacyMode: "generic", dedupeKey: `platform:${randomUUID()}`, status: "done" } });
    await prisma.notificationAttempt.createMany({
      data: [
        { notificationId: n.id, channel: "web_push", status: "failed", errorDigest: "http_410" },
        { notificationId: n.id, channel: "web_push", status: "failed", errorDigest: "http_410" },
        { notificationId: n.id, channel: "sms", status: "failed", errorDigest: "telnyx_40300" },
        { notificationId: n.id, channel: "sms", status: "sent" },
      ],
    });
    const res = await admin(ops)(request(server()).get("/v1/admin/notifications/failures")).expect(200);
    expect(res.body.windowDays).toBe(7);
    expect(res.body.failedTotal).toBe(3);
    expect(res.body.byChannel).toEqual({ web_push: 2, sms: 1 });
    expect(res.body.byKind).toEqual({ refill: 3 });
    expect(res.body.topErrors.web_push).toEqual([{ errorDigest: "http_410", count: 2 }]);
    await admin(ops)(request(server()).get("/v1/admin/notifications/failures?days=99")).expect(400);
  });
});
