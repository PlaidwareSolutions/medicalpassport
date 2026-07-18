import { resolve } from "node:path";
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
 * Stage 7 e2e: doctor-visit summary aggregation, share creation, public
 * token-based access (success/expired/revoked/not-found), selective
 * sections, and the patient-visible access log. PDF export runs through a
 * real apps/worker child process claiming render jobs from the
 * Postgres-backed queue (docs/22 Stage 7 follow-up), not in-process.
 */
describe("Sharing e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: ChildProcessWithoutNullStreams;

  const PHONE = "+919000000301";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, offline_mutations, dead_letter_jobs, background_jobs,
        medication_changes, medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    worker = await startWorker(OBJECT_STORAGE_ROOT);
  }, 60000);

  afterAll(async () => {
    stopWorker(worker);
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  let token: string;
  let profileId: string;

  it("signs in, creates a profile, an allergy, and a medicine", async () => {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE, code: CODE, device: { kind: "browser" } })
      .expect(201);
    token = verify.body.token;

    const profile = await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Sharing Test", yearOfBirth: 1962, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/allergies"))
      .send({ label: "Dust", severity: "mild" })
      .expect(201);

    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Sharing Test Medicine",
        source: "manual",
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" },
      })
      .expect(201);
  });

  it("builds a doctor-visit summary live, including the medicine and allergy just added", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/visit-summary")).expect(
      200,
    );
    expect(res.body.profile.displayName).toBe("Sharing Test");
    expect(res.body.currentMedications).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Sharing Test Medicine" })]),
    );
    expect(res.body.allergies).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Dust" })]));
    expect(new Date(res.body.generatedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  let shareToken: string;
  let shareId: string;

  it("creates a share and the public endpoint serves the live summary with no auth", async () => {
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({ sections: {}, expiresInHours: 24, kind: "qr" })
      .expect(201);
    shareToken = created.body.token;
    shareId = created.body.id;
    expect(shareToken).toBeTruthy();

    const publicRes = await request(app.getHttpServer()).get(`/v1/public/shares/${shareToken}`).expect(200);
    expect(publicRes.body.currentMedications).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Sharing Test Medicine" })]),
    );
    expect(publicRes.headers["cache-control"]).toContain("no-store");
  });

  it("respects selective sections — a medications-only share omits allergies", async () => {
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({
        sections: { medications: true, allergies: false, conditions: false, recentChanges: false, concerns: false },
        expiresInHours: 1,
        kind: "link",
      })
      .expect(201);

    const publicRes = await request(app.getHttpServer()).get(`/v1/public/shares/${created.body.token}`).expect(200);
    expect(publicRes.body.currentMedications).toBeTruthy();
    expect(publicRes.body.allergies).toBeUndefined();
  });

  it("exports the patient's own doctor-visit summary as a real PDF", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/visit-summary/pdf")).expect(
      200,
    );
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(res.body.length).toBeGreaterThan(1000);
  }, 30000);

  it("exports a public share as a PDF matching its selective sections, with no auth", async () => {
    const created = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
      .send({
        sections: { medications: true, allergies: false, conditions: false, recentChanges: false, concerns: false },
        expiresInHours: 1,
        kind: "link",
      })
      .expect(201);

    const res = await request(app.getHttpServer()).get(`/v1/public/shares/${created.body.token}/pdf`).expect(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.subarray(0, 4).toString("ascii")).toBe("%PDF");

    // The access is real and audited, same as the JSON path.
    const log = await auth(token, profileId)(
      request(app.getHttpServer()).get(`/v1/shares/${created.body.id}/accesses`),
    ).expect(200);
    expect(log.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ result: "success" })]));
  }, 30000);

  it("rejects a PDF export for an unknown token the same way as the JSON path", async () => {
    const res = await request(app.getHttpServer()).get("/v1/public/shares/not-a-real-token-at-all/pdf").expect(404);
    expect(res.body.title).toBe("This link is no longer available");
  });

  it("records every access attempt in the patient-visible log", async () => {
    await request(app.getHttpServer()).get(`/v1/public/shares/${shareToken}`).expect(200);

    const log = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/shares/${shareId}/accesses`)).expect(200);
    expect(log.body.items.length).toBeGreaterThanOrEqual(2);
    expect(log.body.items.every((i: { result: string }) => i.result === "success")).toBe(true);
  });

  it("rejects an unknown token without revealing why, and never as a 500", async () => {
    const res = await request(app.getHttpServer()).get("/v1/public/shares/not-a-real-token-at-all").expect(404);
    expect(res.body.title).toBe("This link is no longer available");
  });

  it("rejects an expired share and records the expiry in the access log", async () => {
    await prisma.shareLink.update({ where: { id: shareId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(app.getHttpServer()).get(`/v1/public/shares/${shareToken}`).expect(404);

    const log = await auth(token, profileId)(request(app.getHttpServer()).get(`/v1/shares/${shareId}/accesses`)).expect(200);
    expect(log.body.items[0].result).toBe("expired");

    // Restore for the revoke test below.
    await prisma.shareLink.update({ where: { id: shareId }, data: { expiresAt: new Date(Date.now() + 60_000) } });
  });

  it("revoking a share makes it immediately and permanently inaccessible", async () => {
    await request(app.getHttpServer()).get(`/v1/public/shares/${shareToken}`).expect(200);

    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/shares/${shareId}/revoke`)).expect(201);

    const afterRevoke = await request(app.getHttpServer()).get(`/v1/public/shares/${shareToken}`).expect(404);
    expect(afterRevoke.body.title).toBe("This link is no longer available");

    const shares = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/shares")).expect(200);
    const revoked = shares.body.items.find((s: { id: string }) => s.id === shareId);
    expect(revoked.revokedAt).toBeTruthy();

    const audits = await prisma.auditEvent.findMany({
      where: { patientProfileId: profileId, action: { in: ["share.created", "share.accessed", "share.revoked"] } },
    });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["share.created", "share.accessed", "share.revoked"]),
    );
  });
});
