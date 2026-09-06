import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { awaitReadAudits } from "./helpers/audit";
import { stepUp } from "./helpers/step-up";
import { authHeaders, patientSignIn, providerSignIn, seedOrganization } from "./helpers/provider";

/**
 * QR onboarding (docs_v2/06 P11-3): the patient mints a short-lived,
 * single-use token naming the sections a clinic may read; the clinic
 * redeems it into a ProviderPatientLink; every read through the link is
 * limited to those sections and audited with the organization id; the
 * patient can revoke at any time.
 */
describe("Provider onboarding e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  const PATIENT = "+919000001201";
  const CLINIC_OWNER = "+919000001202";
  const PHARMACY_OWNER = "+919000001203";

  let clinicId: string;
  let patientToken: string;
  let profileId: string;
  let clinicToken: string;
  let pharmacyToken: string;
  let qrToken: string;
  let linkId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, provider_proposals, provider_patient_links,
        organization_members, organizations, share_access_events, share_links, share_packages,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
    ({ organizationId: clinicId } = await seedOrganization({ kind: "clinic", displayName: "Sunrise Clinic", ownerPhone: CLINIC_OWNER }));
    await seedOrganization({ kind: "pharmacy", displayName: "Corner Pharmacy", ownerPhone: PHARMACY_OWNER });
    clinicToken = await providerSignIn(server(), CLINIC_OWNER);
    pharmacyToken = await providerSignIn(server(), PHARMACY_OWNER);
    patientToken = await patientSignIn(server(), PATIENT);
    profileId = (
      await authHeaders(patientToken)(request(server()).post("/v1/profiles"))
        .send({ displayName: "Asha Rao", yearOfBirth: 1968, preferredLocale: "en" })
        .expect(201)
    ).body.id;
    await authHeaders(patientToken, profileId)(request(server()).post("/v1/profiles/current/medications"))
      .send({ enteredName: "Metformin 500", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" } })
      .expect(201);
    await authHeaders(patientToken, profileId)(request(server()).post("/v1/profiles/current/allergies"))
      .send({ label: "Penicillin", severity: "severe" })
      .expect(201);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it("minting a token is a step-up operation", async () => {
    const res = await authHeaders(patientToken, profileId)(request(server()).post("/v1/profiles/current/onboarding-tokens"))
      .send({ sections: ["medications", "allergies"], expiresIn: "15m" })
      .expect(403);
    expect(res.body.code).toBe("step_up_required");
  });

  it("mints a short-lived token hashed at rest", async () => {
    await stepUp(server(), patientToken);
    const res = await authHeaders(patientToken, profileId)(request(server()).post("/v1/profiles/current/onboarding-tokens"))
      .send({ sections: ["medications", "allergies"], expiresIn: "15m", accessDays: 7 })
      .expect(201);
    qrToken = res.body.token;
    expect(typeof qrToken).toBe("string");
    expect(res.body.sections).toEqual(["medications", "allergies"]);
    expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
    const rows = await prisma.shareLink.findMany({ where: { audience: "provider_onboarding" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(qrToken);
    // Not a share the patient manages — the share list stays empty.
    const shares = await authHeaders(patientToken, profileId)(request(server()).get("/v1/profiles/current/shares")).expect(200);
    expect(shares.body.items ?? shares.body).toHaveLength(0);
    // Not redeemable as a public share link either.
    await request(server()).get(`/v1/public/shares/${qrToken}`).expect(404);
  });

  it("an unknown code is a 404 for the clinic", async () => {
    await authHeaders(clinicToken)(request(server()).post("/v1/provider/patients/onboard")).send({ qrToken: "not-a-real-token-at-all" }).expect(404);
  });

  it("the clinic redeems the token once into a section-scoped link", async () => {
    const res = await authHeaders(clinicToken)(request(server()).post("/v1/provider/patients/onboard")).send({ qrToken }).expect(201);
    linkId = res.body.linkId;
    expect(res.body).toMatchObject({ patient: { displayName: "Asha Rao", yearOfBirth: 1968 }, sections: ["medications", "allergies"], status: "active" });
    expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60_000);
    const link = await prisma.providerPatientLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(link).toMatchObject({ organizationId: clinicId, patientProfileId: profileId, linkedVia: "qr_onboarding" });
    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.link_created", entityId: linkId } });
    expect(audit?.context).toMatchObject({ organizationId: clinicId });
    expect(audit?.patientProfileId).toBe(profileId);
    // single use
    await authHeaders(pharmacyToken)(request(server()).post("/v1/provider/patients/onboard")).send({ qrToken }).expect(404);
  });

  it("lists linked patients as labels only", async () => {
    const res = await authHeaders(clinicToken)(request(server()).get("/v1/provider/patients")).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ linkId, patient: { displayName: "Asha Rao" } });
    expect(JSON.stringify(res.body)).not.toContain("Metformin");
    await awaitReadAudits();
    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.patients_listed" } });
    expect(audit?.context).toMatchObject({ organizationId: clinicId });
  });

  it("reads the Doctor Snapshot within the granted sections, audited with the organization id", async () => {
    const res = await authHeaders(clinicToken)(request(server()).get(`/v1/provider/patients/${linkId}/snapshot`)).expect(200);
    expect(res.body.sections).toEqual(["medications", "allergies"]);
    expect(res.body.currentMedications.map((m: { name: string }) => m.name)).toContain("Metformin 500");
    // Provider-web reconciliation lines refer to medicines by id (unlike the public share, which carries none).
    expect(res.body.currentMedications.every((m: { patientMedicationId?: string }) => typeof m.patientMedicationId === "string")).toBe(true);
    expect(res.body.allergies.map((a: { label: string }) => a.label)).toEqual(["Penicillin"]);
    expect(res.body.majorConditions).toBeUndefined();
    expect(res.body.latestResults).toBeUndefined();
    expect(res.body.measurements).toBeUndefined();
    expect(res.body.documents).toBeUndefined();
    await awaitReadAudits();
    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.snapshot_viewed", entityId: linkId } });
    expect(audit?.context).toMatchObject({ organizationId: clinicId, sections: ["medications", "allergies"] });
    expect(audit?.patientProfileId).toBe(profileId);
  });

  it("another organization cannot read through the clinic's link", async () => {
    await authHeaders(pharmacyToken)(request(server()).get(`/v1/provider/patients/${linkId}/snapshot`)).expect(404);
    const list = await authHeaders(pharmacyToken)(request(server()).get("/v1/provider/patients")).expect(200);
    expect(list.body.items).toHaveLength(0);
    // and a patient session never reaches the provider surface
    await authHeaders(patientToken)(request(server()).get(`/v1/provider/patients/${linkId}/snapshot`)).expect(401);
  });

  it("the patient sees the link and revokes it (step-up); the clinic's access ends immediately", async () => {
    const list = await authHeaders(patientToken, profileId)(request(server()).get("/v1/profiles/current/provider-links")).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: linkId, organization: { id: clinicId, displayName: "Sunrise Clinic", kind: "clinic" }, status: "active" });

    // fresh session without step-up
    const cold = await patientSignIn(server(), PATIENT);
    const denied = await authHeaders(cold, profileId)(request(server()).post(`/v1/provider-links/${linkId}/revoke`)).expect(403);
    expect(denied.body.code).toBe("step_up_required");

    await stepUp(server(), patientToken);
    const res = await authHeaders(patientToken, profileId)(request(server()).post(`/v1/provider-links/${linkId}/revoke`)).expect(201);
    expect(res.body.status).toBe("revoked");
    await authHeaders(clinicToken)(request(server()).get(`/v1/provider/patients/${linkId}/snapshot`)).expect(404);
    const patients = await authHeaders(clinicToken)(request(server()).get("/v1/provider/patients")).expect(200);
    expect(patients.body.items).toHaveLength(0);
    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.link_revoked", entityId: linkId } });
    expect(audit?.context).toMatchObject({ organizationId: clinicId });
    expect(audit?.actorType).toBe("patient");
  });

  it("an expired token cannot be redeemed", async () => {
    await stepUp(server(), patientToken);
    const res = await authHeaders(patientToken, profileId)(request(server()).post("/v1/profiles/current/onboarding-tokens"))
      .send({ sections: ["medications"], expiresIn: "1h" })
      .expect(201);
    await prisma.shareLink.update({ where: { id: res.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await authHeaders(clinicToken)(request(server()).post("/v1/provider/patients/onboard")).send({ qrToken: res.body.token }).expect(404);
    expect(await prisma.providerPatientLink.count({ where: { organizationId: clinicId, status: "active" } })).toBe(0);
  });

  it("an expired link is invisible to the provider and shown as expired to the patient", async () => {
    await stepUp(server(), patientToken);
    const minted = await authHeaders(patientToken, profileId)(request(server()).post("/v1/profiles/current/onboarding-tokens"))
      .send({ sections: ["medications"], expiresIn: "1h", accessDays: 1 })
      .expect(201);
    const link = await authHeaders(clinicToken)(request(server()).post("/v1/provider/patients/onboard")).send({ qrToken: minted.body.token }).expect(201);
    await prisma.providerPatientLink.update({ where: { id: link.body.linkId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await authHeaders(clinicToken)(request(server()).get(`/v1/provider/patients/${link.body.linkId}/snapshot`)).expect(404);
    const list = await authHeaders(patientToken, profileId)(request(server()).get("/v1/profiles/current/provider-links")).expect(200);
    expect(list.body.items.find((l: { id: string }) => l.id === link.body.linkId).status).toBe("expired");
  });
});
