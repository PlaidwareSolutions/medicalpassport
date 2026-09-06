import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { decryptField } from "../src/common/crypto";
import { abhaNumberDigest } from "../src/modules/abdm/abdm.service";
import { MOCK_CARE_CONTEXTS, MOCK_HIP, MOCK_OTP } from "../src/modules/abdm/gateway-client";
import { stepUp } from "./helpers/step-up";

/**
 * ABDM end to end against the mock gateway (docs_v2/05 §10; docs_v2/08 §5 M8A/M8B/M8D, §7, §9):
 * link an ABHA (step-up, encrypted number + digest), discover and link care contexts, receive the
 * replayed consent + bundle, import it — and prove the import created candidates only, that a
 * confirmation stamps `abdm_imported` / `source_authenticated` / `sourceAbdmTxnId`, and that
 * unlinking keeps every imported row.
 */
describe("ABDM e2e (mock gateway)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const PHONE = "+919000000531";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
  const ABHA_NUMBER = "91-1234-5678-9012";

  let token: string;
  let profileId: string;
  let linkTxn: string;
  let discoverTxn: string;
  let bundleId: string;
  let consentId: string;
  let extractionId: string;
  let transferRowId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, fhir_validation_failures, abdm_data_bundles, abdm_consent_artefacts,
        abdm_care_contexts, abha_links, abdm_transactions, health_events, document_candidates, document_extractions,
        document_pages, patient_documents, stored_objects, medication_changes, medication_instructions, patient_medications,
        diagnostic_results, diagnostic_reports, observations, prescription_items, prescriptions, organizations, practitioners,
        patient_allergies, patient_conditions, consent_events, consents, caregiver_permissions, caregiver_relationships,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;
    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Asha Demo", yearOfBirth: 1975, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  const auth = (t: string, pid?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${t}`).set("x-requested-with", "medpass");
    if (pid) req.set("x-profile-id", pid);
    return req;
  };
  const api = () => request(app.getHttpServer());

  describe("M8A — ABHA identity", () => {
    it("starts unlinked", async () => {
      const res = await auth(token, profileId)(api().get("/v1/profiles/current/abha")).expect(200);
      expect(res.body).toEqual({ linked: false, gatewayEnv: "mock" });
    });

    it("link init requires step-up and validates the method's own field", async () => {
      const denied = await auth(token, profileId)(api().post("/v1/profiles/current/abha/link/init")).send({ method: "abha_number", abhaNumber: ABHA_NUMBER }).expect(403);
      expect(denied.body.code).toBe("step_up_required");
      await stepUp(app.getHttpServer(), token);
      await auth(token, profileId)(api().post("/v1/profiles/current/abha/link/init")).send({ method: "abha_number" }).expect(400);
      const res = await auth(token, profileId)(api().post("/v1/profiles/current/abha/link/init")).send({ method: "abha_number", abhaNumber: ABHA_NUMBER }).expect(202);
      expect(res.body.transactionId).toMatch(/^mock-link-/);
      expect(res.body.otpSentTo).toBe("******9012");
      linkTxn = res.body.transactionId;
      const txn = await prisma.abdmTransaction.findFirst({ where: { patientProfileId: profileId, kind: "abha.link.init" } });
      expect(txn).toMatchObject({ direction: "outbound", status: "completed", transactionId: linkTxn, gatewayEnv: "mock" });
      expect(txn!.correlationId).toBeTruthy();
    });

    it("rejects a wrong OTP and records the failed transaction", async () => {
      const res = await auth(token, profileId)(api().post("/v1/profiles/current/abha/link/verify")).send({ transactionId: linkTxn, otp: "111111" }).expect(400);
      expect(res.body.code).toBe("otp_invalid");
      const failed = await prisma.abdmTransaction.findFirst({ where: { patientProfileId: profileId, kind: "abha.link.verify", status: "failed" } });
      expect(failed?.errorCode).toBe("otp_invalid");
      await auth(token, profileId)(api().post("/v1/profiles/current/abha/link/verify")).send({ transactionId: "mock-link-unknown", otp: MOCK_OTP }).expect(404);
    });

    it("verifies the OTP, stores the ABHA number encrypted with a digest index, and audits", async () => {
      const res = await auth(token, profileId)(api().post("/v1/profiles/current/abha/link/verify")).send({ transactionId: linkTxn, otp: MOCK_OTP }).expect(201);
      expect(res.body.linked).toBe(true);
      expect(res.body.abhaNumberMasked).toBe("91-XXXX-XXXX-9012");
      expect(res.body.abhaAddress).toMatch(/@sbx$/);

      const link = await prisma.abhaLink.findFirstOrThrow({ where: { patientProfileId: profileId, status: "active" } });
      expect(link.abhaNumberCiphertext).not.toContain("9012");
      expect(decryptField(link.abhaNumberCiphertext)).toBe(ABHA_NUMBER);
      expect(link.abhaNumberDigest).toBe(abhaNumberDigest(ABHA_NUMBER));
      expect(link.abhaNumberDigest).toHaveLength(64);
      expect(link.profileSnapshot).toMatchObject({ name: "ABDM Sandbox Patient" });

      const status = await auth(token, profileId)(api().get("/v1/profiles/current/abha")).expect(200);
      expect(status.body).toMatchObject({ linked: true, abhaNumberMasked: "91-XXXX-XXXX-9012", careContextCount: 0 });
      expect(JSON.stringify(status.body)).not.toContain("1234-5678");
      const audit = await prisma.auditEvent.findMany({ where: { patientProfileId: profileId, action: { in: ["abha.link_initiated", "abha.linked"] } } });
      expect(audit.map((a) => a.action).sort()).toEqual(["abha.link_initiated", "abha.linked"]);
    });
  });

  describe("M8B — discovery and care contexts", () => {
    it("discovers the mock HIP's care contexts", async () => {
      const started = await auth(token, profileId)(api().post("/v1/profiles/current/abha/discover")).send({}).expect(202);
      discoverTxn = started.body.transactionId;
      const res = await auth(token, profileId)(api().get(`/v1/profiles/current/abha/discover/${discoverTxn}`)).expect(200);
      expect(res.body.status).toBe("completed");
      expect(res.body.patients).toHaveLength(1);
      expect(res.body.patients[0]).toMatchObject({ hipId: MOCK_HIP.hipId, careContexts: MOCK_CARE_CONTEXTS });
      await auth(token, profileId)(api().get("/v1/profiles/current/abha/discover/mock-discover-unknown")).expect(404);
    });

    it("asks for the HIP OTP, then links the contexts and receives the replayed consent + bundle", async () => {
      const body = { transactionId: discoverTxn, hipId: MOCK_HIP.hipId, patientReferenceNumber: "PRN-1", careContextReferences: MOCK_CARE_CONTEXTS.map((c) => c.reference) };
      const pending = await auth(token, profileId)(api().post("/v1/profiles/current/abha/care-contexts/link")).send(body).expect(201);
      expect(pending.body.status).toBe("otp_required");

      const linked = await auth(token, profileId)(api().post("/v1/profiles/current/abha/care-contexts/link")).send({ ...body, otp: MOCK_OTP }).expect(201);
      expect(linked.body.status).toBe("linked");
      expect(linked.body.linked).toHaveLength(2);
      expect(await prisma.abdmCareContext.count({ where: { status: "linked" } })).toBe(2);

      const consents = await auth(token, profileId)(api().get("/v1/profiles/current/abdm/consents")).expect(200);
      expect(consents.body.items).toHaveLength(1);
      expect(consents.body.items[0]).toMatchObject({ status: "granted", hiTypes: ["Prescription"], purposeCode: "CAREMGT" });
      consentId = consents.body.items[0].id;

      const bundles = await auth(token, profileId)(api().get("/v1/profiles/current/abdm/bundles")).expect(200);
      expect(bundles.body.items).toHaveLength(1);
      expect(bundles.body.items[0]).toMatchObject({ importStatus: "received", hiType: "Prescription", igVersion: "6.5" });
      bundleId = bundles.body.items[0].id;
      const transfer = await prisma.abdmTransaction.findFirstOrThrow({ where: { kind: "health-information.transfer", direction: "inbound" } });
      transferRowId = transfer.id;
    });
  });

  describe("§7 — import creates candidates, never clinical rows", () => {
    it("files the bundle as an ABDM document with candidates and touches no clinical table", async () => {
      const before = {
        medications: await prisma.patientMedication.count(),
        prescriptions: await prisma.prescription.count(),
        practitioners: await prisma.practitioner.count(),
        organizations: await prisma.organization.count(),
      };
      const res = await auth(token, profileId)(api().post(`/v1/abdm/bundles/${bundleId}/import`)).expect(201);
      expect(res.body).toMatchObject({ bundleId, importStatus: "candidates_created" });
      expect(res.body.candidateCount).toBeGreaterThanOrEqual(8);
      extractionId = res.body.extractionId;

      const document = await prisma.patientDocument.findUniqueOrThrow({ where: { id: res.body.documentId } });
      expect(document).toMatchObject({
        patientProfileId: profileId,
        kind: "prescription",
        sourceChannel: "abdm",
        provenanceSource: "abdm_imported",
        verification: "source_authenticated",
        recordedVia: "abdm",
        sourceAbdmTxnId: transferRowId,
      });
      const candidates = await prisma.documentCandidate.findMany({ where: { extractionId } });
      const entities = new Set(candidates.map((c) => c.targetEntity));
      expect([...entities].sort()).toEqual(["medication", "organization", "practitioner", "prescription"]);
      expect(candidates.every((c) => c.status === "proposed" && c.confidence.toString() === "1")).toBe(true);
      expect(candidates.some((c) => c.targetField === "interpretation" || c.targetField === "doseQuantity")).toBe(false);

      const after = {
        medications: await prisma.patientMedication.count(),
        prescriptions: await prisma.prescription.count(),
        practitioners: await prisma.practitioner.count(),
        organizations: await prisma.organization.count(),
      };
      expect(after).toEqual(before);
      const bundle = await prisma.abdmDataBundle.findUniqueOrThrow({ where: { id: bundleId } });
      expect(bundle.importStatus).toBe("candidates_created");
      expect(bundle.entryCount).toBeGreaterThan(0);
      const audit = await prisma.auditEvent.findFirst({ where: { action: "abdm.bundle_imported", entityId: bundleId } });
      expect(audit).not.toBeNull();
    });

    it("refuses a second import of the same bundle", async () => {
      const res = await auth(token, profileId)(api().post(`/v1/abdm/bundles/${bundleId}/import`)).expect(409);
      expect(res.body.code).toBe("invalid_status_transition");
    });

    it("a confirmed candidate materializes with the bundle's provenance, not OCR's", async () => {
      const group = await prisma.documentCandidate.findMany({ where: { extractionId, targetEntity: "practitioner" } });
      expect(group.length).toBeGreaterThan(0);
      const res = await auth(token, profileId)(api().post(`/v1/document-extractions/${extractionId}/materialize`))
        .send({ candidateIds: group.map((c) => c.id) })
        .expect(201);
      const created = (res.body.created as Array<{ entityType: string; entityId: string }>).find((r) => r.entityType === "practitioner");
      expect(created).toBeDefined();
      const practitioner = await prisma.practitioner.findUniqueOrThrow({ where: { id: created!.entityId } });
      expect(practitioner.displayName).toBe("Dr. Meera Iyer");
      expect(practitioner.verification).toBe("source_authenticated");
      const stamped = await prisma.documentCandidate.findFirst({ where: { id: group[0]!.id } });
      expect(stamped?.status).toBe("confirmed");
      expect(stamped?.resultingEntityId).toBe(practitioner.id);
    });
  });

  describe("M8D — consent revoke and unlink keep imported rows", () => {
    it("revokes a consent (step-up) and refuses a second revoke", async () => {
      // The session is still inside the 10-minute step-up window from link/init (ADR-V2-012);
      // the guard itself is proven there and by openapi/coverage.spec.ts (`stepUp: true` ↔ decorator).
      await stepUp(app.getHttpServer(), token);
      const res = await auth(token, profileId)(api().post(`/v1/profiles/current/abdm/consents/${consentId}/revoke`)).send({ reason: "No longer needed" }).expect(201);
      expect(res.body.status).toBe("revoked");
      expect(res.body.revokedAt).toBeTruthy();
      await auth(token, profileId)(api().post(`/v1/profiles/current/abdm/consents/${consentId}/revoke`)).send({}).expect(409);
      expect(await prisma.auditEvent.count({ where: { action: "abdm.consent_revoked", entityId: consentId } })).toBe(1);
    });

    it("unlinks the ABHA; imported document, candidates and care contexts stay", async () => {
      await auth(token, profileId)(api().delete("/v1/profiles/current/abha")).expect(204);
      const status = await auth(token, profileId)(api().get("/v1/profiles/current/abha")).expect(200);
      expect(status.body.linked).toBe(false);
      expect(await prisma.abhaLink.count({ where: { patientProfileId: profileId, status: "unlinked" } })).toBe(1);
      expect(await prisma.patientDocument.count({ where: { patientProfileId: profileId, provenanceSource: "abdm_imported", deletedAt: null } })).toBe(1);
      expect(await prisma.documentCandidate.count({ where: { extractionId } })).toBeGreaterThan(0);
      expect(await prisma.abdmCareContext.count()).toBe(2);
      expect(await prisma.practitioner.count({ where: { verification: "source_authenticated" } })).toBe(1);
      await auth(token, profileId)(api().delete("/v1/profiles/current/abha")).expect(404);
      await auth(token, profileId)(api().post("/v1/profiles/current/abha/discover")).send({}).expect(409);
    });
  });
});
