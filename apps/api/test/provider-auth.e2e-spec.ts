import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { phoneDigest } from "../src/common/crypto";
import { authHeaders, patientSignIn, providerSignIn, seedOrganization } from "./helpers/provider";

/**
 * Provider-portal auth (docs_v2/06 P11-2): phone OTP sign-in into a
 * *provider-type* session, never interchangeable with a patient or admin
 * session; organization context and owner-only member management.
 */
describe("Provider auth e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  const OWNER = "+919000001101";
  const DOCTOR = "+919000001102";
  const PATIENT = "+919000001103";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  let organizationId: string;
  let ownerToken: string;
  let patientToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, provider_proposals, provider_patient_links,
        organization_members, organizations, sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
    ({ organizationId } = await seedOrganization({ kind: "clinic", displayName: "Sunrise Clinic", ownerPhone: OWNER }));
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it("requests an OTP without revealing whether the number is a provider", async () => {
    await prisma.otpAttempt.deleteMany({});
    const known = await request(server()).post("/v1/provider/auth/login").send({ phone: OWNER }).expect(202);
    const unknown = await request(server()).post("/v1/provider/auth/login").send({ phone: "+919000001199" }).expect(202);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.method).toBe("phone_otp");
  });

  it("rejects a wrong code, then issues a provider session for the right one", async () => {
    await request(server()).post("/v1/provider/auth/totp").send({ phone: OWNER, code: "123456" }).expect(400);
    const res = await request(server()).post("/v1/provider/auth/totp").send({ phone: OWNER, code: CODE }).expect(201);
    ownerToken = res.body.token;
    expect(ownerToken.startsWith("mpp_")).toBe(true);
    expect(res.body.organizations).toEqual([{ id: organizationId, displayName: "Sunrise Clinic", kind: "clinic", role: "owner" }]);
    expect(String(res.headers["set-cookie"])).toContain("medpass_provider_session=");
    expect(await prisma.auditEvent.count({ where: { action: "provider.session_created" } })).toBe(1);
  });

  it("refuses a correct code for a number that is not an organization member", async () => {
    patientToken = await patientSignIn(server(), PATIENT);
    await prisma.otpAttempt.deleteMany({ where: { phoneDigest: phoneDigest(PATIENT) } });
    await request(server()).post("/v1/provider/auth/login").send({ phone: PATIENT }).expect(202);
    const res = await request(server()).post("/v1/provider/auth/totp").send({ phone: PATIENT, code: CODE }).expect(403);
    expect(res.body.code).toBe("forbidden");
    // The correct code is spent: a retry on the patient surface must not ride on it.
    await request(server()).post("/v1/auth/otp/verify").send({ phone: PATIENT, code: CODE, device: { kind: "browser" } }).expect(400);
  });

  it("session types are never interchangeable", async () => {
    // provider token on the patient surface
    await authHeaders(ownerToken)(request(server()).get("/v1/auth/session")).expect(401);
    await authHeaders(ownerToken)(request(server()).get("/v1/profiles")).expect(401);
    // patient token on the provider surface
    await authHeaders(patientToken)(request(server()).get("/v1/provider/organizations/current")).expect(401);
    await authHeaders(patientToken)(request(server()).get("/v1/provider/auth/session")).expect(401);
    // provider token on the admin surface
    await authHeaders(ownerToken)(request(server()).get("/v1/admin/auth/me")).expect(401);
    // a provider token is a session row with a domain-separated hash: the raw token never matches the patient hash
    const { hashSessionToken } = await import("../src/common/crypto");
    expect(await prisma.session.findUnique({ where: { tokenHash: hashSessionToken(ownerToken) } })).toBeNull();
  });

  it("exposes the current session and organization", async () => {
    const res = await authHeaders(ownerToken)(request(server()).get("/v1/provider/auth/session")).expect(200);
    expect(res.body.userKind).toBe("provider");
    expect(res.body.current).toEqual({ organizationId, role: "owner" });
    const org = await authHeaders(ownerToken)(request(server()).get("/v1/provider/organizations/current")).expect(200);
    expect(org.body).toMatchObject({
      id: organizationId,
      kind: "clinic",
      displayName: "Sunrise Clinic",
      role: "owner",
      memberCount: 1,
      allowedProposalKinds: ["reconciliation", "prescription", "encounter"],
    });
  });

  it("owner updates the organization; the change is audited with the organization id", async () => {
    const res = await authHeaders(ownerToken)(request(server()).patch("/v1/provider/organizations/current"))
      .send({ displayName: "Sunrise Family Clinic", city: "Hyderabad", phone: "+914012345678" })
      .expect(200);
    expect(res.body).toMatchObject({ displayName: "Sunrise Family Clinic", city: "Hyderabad", phone: "+914012345678" });
    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.organization_updated" } });
    expect(audit?.context).toMatchObject({ organizationId });
  });

  let memberId: string;
  let doctorToken: string;

  it("owner adds a member by phone; the member signs in but cannot manage the organization", async () => {
    const res = await authHeaders(ownerToken)(request(server()).post("/v1/provider/organizations/current/members"))
      .send({ phone: DOCTOR, role: "doctor" })
      .expect(201);
    memberId = res.body.id;
    expect(res.body).toMatchObject({ role: "doctor", status: "active", phone: DOCTOR });
    const user = await prisma.user.findUniqueOrThrow({ where: { phoneDigest: phoneDigest(DOCTOR) } });
    expect(user.userKind).toBe("provider");

    doctorToken = await providerSignIn(server(), DOCTOR);
    const org = await authHeaders(doctorToken)(request(server()).get("/v1/provider/organizations/current")).expect(200);
    expect(org.body.role).toBe("doctor");
    await authHeaders(doctorToken)(request(server()).patch("/v1/provider/organizations/current")).send({ city: "X" }).expect(403);
    await authHeaders(doctorToken)(request(server()).get("/v1/provider/organizations/current/members")).expect(403);
    await authHeaders(doctorToken)(request(server()).post("/v1/provider/organizations/current/members")).send({ phone: "+919000001188" }).expect(403);

    const members = await authHeaders(ownerToken)(request(server()).get("/v1/provider/organizations/current/members")).expect(200);
    expect(members.body.items.map((m: { role: string }) => m.role).sort()).toEqual(["doctor", "owner"]);
    await authHeaders(ownerToken)(request(server()).post("/v1/provider/organizations/current/members")).send({ phone: DOCTOR }).expect(400);
  });

  it("owner changes a role; the last owner cannot be demoted", async () => {
    const res = await authHeaders(ownerToken)(request(server()).patch(`/v1/provider/organizations/current/members/${memberId}`))
      .send({ role: "staff" })
      .expect(200);
    expect(res.body.role).toBe("staff");
    const owners = await prisma.organizationMember.findMany({ where: { organizationId, role: "owner" } });
    const demote = await authHeaders(ownerToken)(request(server()).patch(`/v1/provider/organizations/current/members/${owners[0]!.id}`))
      .send({ role: "doctor" })
      .expect(400);
    expect(demote.body.code).toBe("validation_failed");
  });

  it("removing a member ends their access on the very next request", async () => {
    await authHeaders(ownerToken)(request(server()).delete(`/v1/provider/organizations/current/members/${memberId}`)).expect(204);
    await authHeaders(doctorToken)(request(server()).get("/v1/provider/organizations/current")).expect(403);
    await authHeaders(ownerToken)(request(server()).delete(`/v1/provider/organizations/current/members/${memberId}`)).expect(404);
    expect(await prisma.auditEvent.count({ where: { action: "provider.member_removed" } })).toBe(1);
  });

  it("a member of two organizations must name the one a request acts for", async () => {
    const other = await seedOrganization({ kind: "pharmacy", displayName: "Corner Pharmacy", ownerPhone: OWNER });
    const res = await authHeaders(ownerToken)(request(server()).get("/v1/provider/organizations/current")).expect(400);
    expect(res.body.code).toBe("validation_failed");
    const picked = await authHeaders(ownerToken)(request(server()).get("/v1/provider/organizations/current"))
      .set("x-organization-id", other.organizationId)
      .expect(200);
    expect(picked.body).toMatchObject({ id: other.organizationId, kind: "pharmacy", allowedProposalKinds: ["dispense"] });
    await authHeaders(ownerToken)(request(server()).get("/v1/provider/organizations/current"))
      .set("x-organization-id", "00000000-0000-0000-0000-000000000000")
      .expect(403);
    await prisma.organizationMember.deleteMany({ where: { organizationId: other.organizationId } });
  });

  it("logout revokes the provider session", async () => {
    await authHeaders(ownerToken)(request(server()).post("/v1/provider/auth/logout")).expect(204);
    await authHeaders(ownerToken)(request(server()).get("/v1/provider/auth/session")).expect(401);
    expect(await prisma.auditEvent.count({ where: { action: "provider.session_revoked" } })).toBe(1);
  });

  it("cookie-borne state-changing requests need the CSRF header", async () => {
    const token = await providerSignIn(server(), OWNER);
    await request(server()).post("/v1/provider/auth/logout").set("cookie", `medpass_provider_session=${token}`).expect(403);
    await request(server()).post("/v1/provider/auth/logout").set("cookie", `medpass_provider_session=${token}`).set("x-requested-with", "medpass").expect(204);
  });
});
