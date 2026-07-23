import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Dependent-profile claiming (docs/07 screen 5, docs/23 E3.1 "claimable
 * later"): a caregiver invites the actual profile subject to take over as
 * its real owner; the original caregiver automatically retains
 * full_management-level access (user-confirmed product decision).
 */
describe("Profile claim e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_CAREGIVER = "+919000010001";
  const PHONE_CLAIMANT = "+919000010002";
  const PHONE_STRANGER = "+919000010003";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, offline_mutations, medication_changes,
        medication_instructions, patient_medications, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signIn(phone: string): Promise<string> {
    // This file signs the same handful of phone numbers in and out many
    // times across test cases — clear resend-cooldown state first (same
    // pattern as api.e2e-spec.ts) rather than using a fresh phone per call.
    await prisma.otpAttempt.deleteMany({});
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const res = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser", label: "jest" } })
      .expect(201);
    return res.body.token;
  }

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  let caregiverToken: string;
  let dependentProfileId: string;

  it("signs in the caregiver and creates a dependent profile", async () => {
    caregiverToken = await signIn(PHONE_CAREGIVER);
    const res = await auth(caregiverToken)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Dependent Profile", relationship: "child", preferredLocale: "en" })
      .expect(201);
    dependentProfileId = res.body.id;

    const stored = await prisma.patientProfile.findUniqueOrThrow({ where: { id: dependentProfileId } });
    expect(stored.dependentRelationship).toBe("child");
  });

  it("invites the dependent to claim, shows up for the claimant, and the offered scopes preview the whole point of claiming (full self-access)", async () => {
    await auth(caregiverToken, dependentProfileId)(request(app.getHttpServer()).post("/v1/profiles/current/claim-invite"))
      .send({ phone: PHONE_CLAIMANT })
      .expect(201);

    const claimantToken = await signIn(PHONE_CLAIMANT);
    const invitations = await auth(claimantToken)(request(app.getHttpServer()).get("/v1/profiles/claim-invitations")).expect(200);
    expect(invitations.body.items.map((i: { profileId: string }) => i.profileId)).toContain(dependentProfileId);

    // A stranger (different phone) sees nothing.
    const strangerToken = await signIn(PHONE_STRANGER);
    const strangerInvitations = await auth(strangerToken)(
      request(app.getHttpServer()).get("/v1/profiles/claim-invitations"),
    ).expect(200);
    expect(strangerInvitations.body.items).toEqual([]);

    // Stranger cannot claim it either.
    const strangerClaim = await auth(strangerToken)(request(app.getHttpServer()).post("/v1/profiles/claim")).send({
      profileId: dependentProfileId,
    });
    expect(strangerClaim.status).toBe(404);
  });

  it("claims the profile, grants the original caregiver reciprocal full_management access, and both list() and session-refresh reflect it", async () => {
    const claimantToken = await signIn(PHONE_CLAIMANT);
    const claim = await auth(claimantToken)(request(app.getHttpServer()).post("/v1/profiles/claim"))
      .send({ profileId: dependentProfileId })
      .expect(201);
    expect(claim.body.id).toBe(dependentProfileId);

    const stored = await prisma.patientProfile.findUniqueOrThrow({ where: { id: dependentProfileId } });
    expect(stored.claimedByUserId).toBeTruthy();
    expect(stored.claimInvitedPhoneDigest).toBeNull();

    const relationship = await prisma.caregiverRelationship.findFirst({
      where: { patientProfileId: dependentProfileId, status: "active" },
      include: { permissions: true },
    });
    expect(relationship).toBeTruthy();
    expect(relationship!.relationship).toBe("parent"); // caregiver recorded dependent as "child" -> inverted to "parent"
    expect(relationship!.permissions.map((p) => p.scope)).toEqual(["full_management"]);

    // list() reflects the original caregiver as "caregiver", not stale "dependent".
    const profiles = await auth(caregiverToken)(request(app.getHttpServer()).get("/v1/profiles")).expect(200);
    const entry = profiles.body.items.find((p: { id: string }) => p.id === dependentProfileId);
    expect(entry.relationship).toBe("caregiver");

    // A fresh sign-in (session response) reflects the same fix independently
    // — this is the whole point of the shared computeProfileRelationship()
    // helper, not just list()'s own response.
    await prisma.otpAttempt.deleteMany({});
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone: PHONE_CAREGIVER }).expect(202);
    const verifyRes = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone: PHONE_CAREGIVER, code: CODE, device: { kind: "browser", label: "jest2" } })
      .expect(201);
    const sessionEntry = verifyRes.body.profiles.find((p: { id: string }) => p.id === dependentProfileId);
    expect(sessionEntry).toBeTruthy();
    expect(sessionEntry.relationship).toBe("caregiver");

    // Original caregiver retains real access (full_management grants edit_medications)...
    await auth(caregiverToken, dependentProfileId)(request(app.getHttpServer()).get("/v1/profiles/current/medications")).expect(200);

    // ...but loses owner-only actions on this profile (manage_caregivers grants to no scope, ever).
    const inviteAttempt = await auth(caregiverToken, dependentProfileId)(
      request(app.getHttpServer()).post("/v1/profiles/current/caregivers"),
    ).send({ phone: "+919000099999", scopes: ["view_medications"], relationship: "other" });
    expect(inviteAttempt.status).toBe(403);
    expect(inviteAttempt.body.code).toBe("caregiver_scope_missing");
  });

  it("rejects claiming an already-claimed profile", async () => {
    const strangerToken = await signIn(PHONE_STRANGER);
    const res = await auth(strangerToken)(request(app.getHttpServer()).post("/v1/profiles/claim")).send({
      profileId: dependentProfileId,
    });
    expect(res.status).toBe(404);
  });

  it("rejects an expired claim invitation", async () => {
    const dep = await auth(caregiverToken)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Expired Invite Dependent", relationship: "parent", preferredLocale: "en" })
      .expect(201);
    await auth(caregiverToken, dep.body.id)(request(app.getHttpServer()).post("/v1/profiles/current/claim-invite"))
      .send({ phone: PHONE_STRANGER, expiresAt: new Date(Date.now() - 60_000).toISOString() })
      .expect(201);

    const strangerToken = await signIn(PHONE_STRANGER);
    const res = await auth(strangerToken)(request(app.getHttpServer()).post("/v1/profiles/claim")).send({
      profileId: dep.body.id,
    });
    expect(res.status).toBe(404);
  });

  it("rejects a self-claim (inviting your own number by mistake)", async () => {
    const dep = await auth(caregiverToken)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Self Claim Dependent", relationship: "other", preferredLocale: "en" })
      .expect(201);
    await auth(caregiverToken, dep.body.id)(request(app.getHttpServer()).post("/v1/profiles/current/claim-invite"))
      .send({ phone: PHONE_CAREGIVER })
      .expect(201);

    const res = await auth(caregiverToken)(request(app.getHttpServer()).post("/v1/profiles/claim")).send({
      profileId: dep.body.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("validation_failed");
  });

  it("lets the owner cancel a pending claim invitation", async () => {
    const dep = await auth(caregiverToken)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
      .send({ displayName: "Cancel Invite Dependent", relationship: "other", preferredLocale: "en" })
      .expect(201);
    await auth(caregiverToken, dep.body.id)(request(app.getHttpServer()).post("/v1/profiles/current/claim-invite"))
      .send({ phone: PHONE_STRANGER })
      .expect(201);
    await auth(caregiverToken, dep.body.id)(request(app.getHttpServer()).delete("/v1/profiles/current/claim-invite")).expect(204);

    const strangerToken = await signIn(PHONE_STRANGER);
    const invitations = await auth(strangerToken)(request(app.getHttpServer()).get("/v1/profiles/claim-invitations")).expect(200);
    expect(invitations.body.items.map((i: { profileId: string }) => i.profileId)).not.toContain(dep.body.id);
  });
});
