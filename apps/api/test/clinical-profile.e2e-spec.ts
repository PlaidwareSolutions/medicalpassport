import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { stepUp } from "./helpers/step-up";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * V2 Phase 1 clinical profile (docs_v2/05 §2, WP P1-3): allergies,
 * conditions, immunizations, procedures, family history, emergency contacts,
 * patient-scoped organizations, practitioner registry fields, blood group /
 * height on the profile. Pins the contracts that make the new rows safe:
 * server-stamped provenance (ADR-V2-002) with client attempts rejected,
 * HealthEvent projection created/superseded in the same transaction
 * (ADR-V2-008), phone ciphertext at rest, profile isolation, and organization
 * merge repointing every link.
 */
describe("Clinical profile e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000981";
  const PHONE_B = "+919000000982";
  const PHONE_C = "+919000000983";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, immunizations, procedures,
        family_history, emergency_contacts, encounters, organizations, dose_events,
        scheduled_doses, medication_schedules, medication_changes, medication_instructions,
        patient_medications, practitioners, prescriptions, medical_reports, safety_findings,
        safety_evaluations, patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions, user_devices, otp_attempts,
        patient_profiles, users CASCADE
    `);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  async function signIn(phone: string): Promise<string> {
    await request(server()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(server())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    return verify.body.token;
  }

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let profileA: string;
  let profileB: string;
  let allergyId: string;
  let conditionId: string;
  let immunizationId: string;
  let procedureId: string;
  let familyHistoryId: string;
  let contactId: string;
  let orgA1: string;
  let orgA2: string;
  let orgB: string;
  let practitionerId: string;

  const liveEvents = (entityType: string, entityId: string) =>
    prisma.healthEvent.findMany({ where: { entityType, entityId, supersededAt: null } });
  const allEvents = (entityType: string, entityId: string) => prisma.healthEvent.findMany({ where: { entityType, entityId } });

  it("signs in two patients with their own profiles", async () => {
    tokenA = await signIn(PHONE_A);
    tokenB = await signIn(PHONE_B);
    const a = await auth(tokenA)(request(server()).post("/v1/profiles"))
      .send({ displayName: "Clinical A", yearOfBirth: 1970, preferredLocale: "en" })
      .expect(201);
    profileA = a.body.id;
    const b = await auth(tokenB)(request(server()).post("/v1/profiles"))
      .send({ displayName: "Clinical B", yearOfBirth: 1975, preferredLocale: "en" })
      .expect(201);
    profileB = b.body.id;
  });

  // ───────────────────────── Allergies ─────────────────────────

  it("creates an allergy with server-stamped provenance and a timeline event", async () => {
    const res = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/allergies"))
      .send({ label: "Penicillin", severity: "severe", category: "medication", criticality: "high", onsetDate: "2015-06-01", codeSystem: "snomed", code: "91936005" })
      .expect(201);
    allergyId = res.body.id;
    expect(res.body.provenanceSource).toBe("user_entered");
    expect(res.body.verification).toBe("patient_confirmed");
    expect(res.body.recordedVia).toBe("pwa");
    expect(res.body.category).toBe("medication");
    expect(res.body.criticality).toBe("high");
    expect(res.body.onsetDate).toBe("2015-06-01");

    const events = await liveEvents("patient_allergy", allergyId);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("allergy_recorded");
    expect(events[0]!.patientProfileId).toBe(profileA);
    expect(events[0]!.provenanceSource).toBe("user_entered");
    expect(events[0]!.verification).toBe("patient_confirmed");
    expect(events[0]!.occurredAtLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect((events[0]!.summary as { label: string }).label).toBe("Penicillin");

    const list = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/allergies")).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(allergyId);
  });

  it("patches an allergy: supersedes and re-emits its event, keeps provenance server-owned", async () => {
    const res = await auth(tokenA, profileA)(request(server()).patch(`/v1/allergies/${allergyId}`))
      .send({ label: "Penicillin V", severity: "moderate", onsetDate: null })
      .expect(200);
    expect(res.body.label).toBe("Penicillin V");
    expect(res.body.severity).toBe("moderate");
    expect(res.body.onsetDate).toBeNull();
    expect(res.body.verification).toBe("patient_confirmed");

    const events = await liveEvents("patient_allergy", allergyId);
    expect(events).toHaveLength(1);
    expect((events[0]!.summary as { label: string }).label).toBe("Penicillin V");
    expect((events[0]!.summary as { severity: string }).severity).toBe("moderate");

    const audit = await prisma.auditEvent.findFirst({ where: { action: "allergy.updated", entityId: allergyId } });
    expect(audit).toBeTruthy();
  });

  it("rejects client-sent provenance on every write with provenance_not_client_settable", async () => {
    for (const body of [
      { label: "Sulfa", verification: "provider_verified" },
      { label: "Sulfa", provenanceSource: "clinic_entered" },
      { label: "Sulfa", source: "professional" },
      { label: "Sulfa", recordedVia: "clinic_portal" },
      { label: "Sulfa", sourceDocumentId: null },
    ]) {
      const res = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/allergies")).send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("provenance_not_client_settable");
    }
    const patch = await auth(tokenA, profileA)(request(server()).patch(`/v1/allergies/${allergyId}`)).send({ verification: "source_authenticated" });
    expect(patch.status).toBe(400);
    expect(patch.body.code).toBe("provenance_not_client_settable");
    const practitioner = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/practitioners")).send({ displayName: "Dr X", verification: "provider_verified" });
    expect(practitioner.body.code).toBe("provenance_not_client_settable");
    const profile = await auth(tokenA, profileA)(request(server()).patch("/v1/profiles/current")).send({ rowVersion: 0, recordedVia: "abdm" });
    expect(profile.body.code).toBe("provenance_not_client_settable");
    // The row is untouched.
    const row = await prisma.patientAllergy.findUniqueOrThrow({ where: { id: allergyId } });
    expect(row.verification).toBe("patient_confirmed");
  });

  it("records the client channel from a validated x-client header, defaulting to pwa", async () => {
    const native = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/allergies"))
      .set("x-client", "native_android")
      .send({ label: "Dust mites", category: "environment" })
      .expect(201);
    expect(native.body.recordedVia).toBe("native_android");
    const unknown = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/allergies"))
      .set("x-client", "curl")
      .send({ label: "Latex" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("validation_failed");
    await auth(tokenA, profileA)(request(server()).delete(`/v1/allergies/${native.body.id}`)).expect(204);
  });

  // ───────────────────────── Conditions ─────────────────────────

  it("creates a condition dated by onset, and a changed onset supersedes the old event", async () => {
    const res = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/conditions"))
      .send({ label: "Type 2 diabetes", clinicalStatus: "active", onsetDate: "2019-03-10", codeSystem: "icd10", code: "E11", severity: "moderate" })
      .expect(201);
    conditionId = res.body.id;
    expect(res.body.provenanceSource).toBe("user_entered");
    expect(res.body.verification).toBe("patient_confirmed");
    expect(res.body.clinicalStatus).toBe("active");
    expect(res.body.onsetDate).toBe("2019-03-10");

    const first = await liveEvents("patient_condition", conditionId);
    expect(first).toHaveLength(1);
    expect(first[0]!.kind).toBe("condition_recorded");
    expect(first[0]!.occurredAtLocal!.startsWith("2019-03-10")).toBe(true);
    expect((first[0]!.summary as { dateSource: string }).dateSource).toBe("onset");

    await auth(tokenA, profileA)(request(server()).patch(`/v1/conditions/${conditionId}`))
      .send({ onsetDate: "2018-11-01", clinicalStatus: "remission", abatementDate: "2024-01-01" })
      .expect(200);
    const all = await allEvents("patient_condition", conditionId);
    expect(all).toHaveLength(2);
    expect(all.filter((e) => e.supersededAt === null)).toHaveLength(1);
    expect(all.find((e) => e.supersededAt === null)!.occurredAtLocal!.startsWith("2018-11-01")).toBe(true);

    const bad = await auth(tokenA, profileA)(request(server()).patch(`/v1/conditions/${conditionId}`)).send({ onsetDate: "2024-05-01", abatementDate: "2024-01-01" });
    expect(bad.status).toBe(400);
    const badLink = await auth(tokenA, profileA)(request(server()).patch(`/v1/conditions/${conditionId}`)).send({ encounterId: "00000000-0000-4000-8000-000000000000" });
    expect(badLink.status).toBe(400);
    expect(badLink.body.errors[0].path).toBe("encounterId");
  });

  it("soft-deletes a condition and supersedes its events", async () => {
    await auth(tokenA, profileA)(request(server()).delete(`/v1/conditions/${conditionId}`)).expect(204);
    const list = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/conditions")).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(conditionId);
    expect(await liveEvents("patient_condition", conditionId)).toHaveLength(0);
    const row = await prisma.patientCondition.findUniqueOrThrow({ where: { id: conditionId } });
    expect(row.deletedAt).not.toBeNull();
    await auth(tokenA, profileA)(request(server()).delete(`/v1/conditions/${conditionId}`)).expect(404);
  });

  // ───────────────────────── Organizations ─────────────────────────

  it("creates patient-scoped organizations with the phone encrypted at rest", async () => {
    const res = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/organizations"))
      .send({ kind: "clinic", displayName: "Apollo Clinic", city: "Hyderabad", pincode: "500033", phone: "+91 40 1234 5678" })
      .expect(201);
    orgA1 = res.body.id;
    expect(res.body.phone).toBe("+914012345678");
    expect(res.body.verification).toBe("patient_confirmed");
    expect(res.body.kind).toBe("clinic");
    const raw = await prisma.organization.findUniqueOrThrow({ where: { id: orgA1 } });
    expect(raw.phoneCiphertext).toBeTruthy();
    expect(raw.phoneCiphertext).not.toContain("4012345678");
    expect(raw.patientProfileId).toBe(profileA);

    orgA2 = (
      await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/organizations"))
        .send({ kind: "hospital", displayName: "Apollo Hospitals Jubilee Hills" })
        .expect(201)
    ).body.id;
    orgB = (
      await auth(tokenB, profileB)(request(server()).post("/v1/profiles/current/organizations"))
        .send({ kind: "laboratory", displayName: "B Labs" })
        .expect(201)
    ).body.id;

    const patched = await auth(tokenA, profileA)(request(server()).patch(`/v1/organizations/${orgA1}`)).send({ addressText: "Road No. 72", phone: null }).expect(200);
    expect(patched.body.addressText).toBe("Road No. 72");
    expect(patched.body.phone).toBeNull();

    const list = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/organizations")).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id).sort()).toEqual([orgA1, orgA2].sort());
  });

  it("accepts registry fields on practitioners and only same-profile organizations", async () => {
    const created = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/practitioners"))
      .send({ displayName: "Dr. Rao", speciality: "Endocrinology", registrationNumber: "TSMC/12345", registrationCouncil: "Telangana State Medical Council" })
      .expect(201);
    practitionerId = created.body.id;
    expect(created.body.registrationNumber).toBe("TSMC/12345");
    expect(created.body.verification).toBe("unverified");

    const patched = await auth(tokenA, profileA)(request(server()).patch(`/v1/practitioners/${practitionerId}`))
      .send({ organizationId: orgA1, registrationCouncil: "TSMC" })
      .expect(200);
    expect(patched.body.organizationId).toBe(orgA1);
    expect(patched.body.registrationCouncil).toBe("TSMC");

    const foreign = await auth(tokenA, profileA)(request(server()).patch(`/v1/practitioners/${practitionerId}`)).send({ organizationId: orgB });
    expect(foreign.status).toBe(400);
    expect(foreign.body.errors[0].path).toBe("organizationId");
  });

  // ───────────────────────── Immunizations ─────────────────────────

  it("creates, lists, patches and deletes an immunization with timeline events", async () => {
    const res = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/immunizations"))
      .send({ vaccineText: "Influenza", doseNumber: 1, administeredOn: "2025-10-02", organizationId: orgA1, lotNumber: "FLU-25-1" })
      .expect(201);
    immunizationId = res.body.id;
    expect(res.body.administeredOn).toBe("2025-10-02");
    expect(res.body.provenanceSource).toBe("user_entered");
    expect(res.body.verification).toBe("patient_confirmed");

    const events = await liveEvents("immunization", immunizationId);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("immunization");
    expect(events[0]!.occurredAtLocal!.startsWith("2025-10-02")).toBe(true);
    expect((events[0]!.summary as { vaccine: string; doseNumber: number }).vaccine).toBe("Influenza");

    const list = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/immunizations")).expect(200);
    expect(list.body.items).toHaveLength(1);

    const patched = await auth(tokenA, profileA)(request(server()).patch(`/v1/immunizations/${immunizationId}`)).send({ doseNumber: 2, administeredOn: "2025-10-03" }).expect(200);
    expect(patched.body.doseNumber).toBe(2);
    expect(patched.body.administeredOn).toBe("2025-10-03");
    const after = await allEvents("immunization", immunizationId);
    expect(after.filter((e) => e.supersededAt === null)).toHaveLength(1);
    expect(after.filter((e) => e.supersededAt !== null)).toHaveLength(1);

    const foreignOrg = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/immunizations")).send({ vaccineText: "Tetanus", administeredOn: "2024-01-01", organizationId: orgB });
    expect(foreignOrg.status).toBe(400);
    const future = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/immunizations")).send({ vaccineText: "Tetanus", administeredOn: "2999-01-01" });
    expect(future.status).toBe(400);
  });

  // ───────────────────────── Procedures ─────────────────────────

  it("creates, patches and deletes a procedure with timeline events", async () => {
    const res = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/procedures"))
      .send({ procedureText: "Appendectomy", performedOn: "2012-08-20", organizationId: orgA2, practitionerId, notes: "Laparoscopic" })
      .expect(201);
    procedureId = res.body.id;
    expect(res.body.performedOn).toBe("2012-08-20");
    expect(res.body.practitionerId).toBe(practitionerId);
    const events = await liveEvents("procedure", procedureId);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("procedure");

    await auth(tokenA, profileA)(request(server()).patch(`/v1/procedures/${procedureId}`)).send({ notes: null, code: "80146002", codeSystem: "snomed" }).expect(200);
    expect(await liveEvents("procedure", procedureId)).toHaveLength(1);

    const list = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/procedures")).expect(200);
    expect(list.body.items[0].id).toBe(procedureId);
    expect(list.body.items[0].notes).toBeNull();

    await auth(tokenA, profileA)(request(server()).delete(`/v1/procedures/${procedureId}`)).expect(204);
    expect(await liveEvents("procedure", procedureId)).toHaveLength(0);
    expect((await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/procedures")).expect(200)).body.items).toHaveLength(0);
  });

  // ───────────────────────── Family history ─────────────────────────

  it("manages family history without producing timeline events", async () => {
    const res = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/family-history"))
      .send({ relationship: "mother", conditionText: "Hypertension" })
      .expect(201);
    familyHistoryId = res.body.id;
    expect(res.body.provenanceSource).toBe("user_entered");
    expect(res.body.verification).toBe("patient_confirmed");
    expect(await prisma.healthEvent.count({ where: { entityType: "family_history" } })).toBe(0);

    const patched = await auth(tokenA, profileA)(request(server()).patch(`/v1/family-history/${familyHistoryId}`)).send({ notes: "Diagnosed at 50" }).expect(200);
    expect(patched.body.notes).toBe("Diagnosed at 50");
    const list = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/family-history")).expect(200);
    expect(list.body.items).toHaveLength(1);
    await auth(tokenA, profileA)(request(server()).delete(`/v1/family-history/${familyHistoryId}`)).expect(204);
    expect((await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/family-history")).expect(200)).body.items).toHaveLength(0);
    expect(await prisma.auditEvent.count({ where: { action: { in: ["family_history.created", "family_history.updated", "family_history.deleted"] }, entityId: familyHistoryId } })).toBe(3);
  });

  // ───────────────────────── Emergency contacts ─────────────────────────

  it("stores emergency-contact phones encrypted and returns E.164 to profile viewers", async () => {
    const res = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/emergency-contacts"))
      .send({ name: "Aisha", relationship: "daughter", phone: "+91 98765 43210", priority: 2 })
      .expect(201);
    contactId = res.body.id;
    expect(res.body.phone).toBe("+919876543210");
    expect(res.body.phoneCiphertext).toBeUndefined();
    const raw = await prisma.emergencyContact.findUniqueOrThrow({ where: { id: contactId } });
    expect(raw.phoneCiphertext).not.toContain("9876543210");
    expect(raw.phoneCiphertext.length).toBeGreaterThan(20);

    const second = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/emergency-contacts"))
      .send({ name: "Ravi", phone: "+919876500000", priority: 1 })
      .expect(201);
    const list = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/emergency-contacts")).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([second.body.id, contactId]);

    const patched = await auth(tokenA, profileA)(request(server()).patch(`/v1/emergency-contacts/${contactId}`)).send({ phone: "+919876543211", priority: 1 }).expect(200);
    expect(patched.body.phone).toBe("+919876543211");
    const rawAfter = await prisma.emergencyContact.findUniqueOrThrow({ where: { id: contactId } });
    expect(rawAfter.phoneCiphertext).not.toBe(raw.phoneCiphertext);
    expect(await prisma.healthEvent.count({ where: { entityType: "emergency_contact" } })).toBe(0);

    await auth(tokenA, profileA)(request(server()).delete(`/v1/emergency-contacts/${second.body.id}`)).expect(204);
    expect((await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/emergency-contacts")).expect(200)).body.items).toHaveLength(1);
  });

  // ───────────────────────── Profile fields ─────────────────────────

  it("accepts bloodGroup and heightCm on the profile", async () => {
    const before = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current")).expect(200);
    expect(before.body.bloodGroup).toBeNull();
    await auth(tokenA, profileA)(request(server()).patch("/v1/profiles/current")).send({ rowVersion: before.body.rowVersion, bloodGroup: "o_pos", heightCm: 172.5 }).expect(200);
    const after = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current")).expect(200);
    expect(after.body.bloodGroup).toBe("o_pos");
    expect(after.body.heightCm).toBe(172.5);
    const invalid = await auth(tokenA, profileA)(request(server()).patch("/v1/profiles/current")).send({ rowVersion: after.body.rowVersion, heightCm: 500 });
    expect(invalid.status).toBe(400);
  });

  // ───────────────────────── Isolation ─────────────────────────

  it("keeps every clinical-profile row isolated to its profile", async () => {
    const denied = await auth(tokenB, profileA)(request(server()).get("/v1/profiles/current/allergies"));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("caregiver_scope_missing");
    for (const path of [`/v1/allergies/${allergyId}`, `/v1/immunizations/${immunizationId}`, `/v1/emergency-contacts/${contactId}`, `/v1/organizations/${orgA1}`, `/v1/practitioners/${practitionerId}`]) {
      const patch = await auth(tokenB, profileB)(request(server()).patch(path)).send({ notes: "x", name: "x", label: "x", displayName: "x", vaccineText: "x" });
      expect(patch.status).toBe(404);
      const del = await auth(tokenB, profileB)(request(server()).delete(path));
      expect(del.status).toBe(404);
    }
    const merge = await auth(tokenB, profileB)(request(server()).post(`/v1/organizations/${orgB}/merge`)).send({ intoId: orgA2 });
    expect(merge.status).toBe(404);
    const contacts = await auth(tokenB, profileB)(request(server()).get("/v1/profiles/current/emergency-contacts")).expect(200);
    expect(contacts.body.items).toHaveLength(0);
  });

  // ───────────────────────── Caregiver provenance ─────────────────────────

  it("stamps caregiver_entered for a caregiver with manage_profile", async () => {
    tokenC = await signIn(PHONE_C);
    await stepUp(server(), tokenA);
    const invite = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_C, scopes: ["manage_profile"], relationship: "child", label: "Son" })
      .expect(201);
    await auth(tokenC)(request(server()).post("/v1/caregivers/accept")).send({ invitationId: invite.body.id }).expect(201);

    const res = await auth(tokenC, profileA)(request(server()).post("/v1/profiles/current/conditions"))
      .send({ label: "Hypertension", clinicalStatus: "active" })
      .expect(201);
    expect(res.body.provenanceSource).toBe("caregiver_entered");
    expect(res.body.verification).toBe("patient_confirmed");
    const events = await liveEvents("patient_condition", res.body.id);
    expect(events[0]!.actorType).toBe("caregiver");
    expect(events[0]!.provenanceSource).toBe("caregiver_entered");

    // The caregiver's edit of the patient's own allergy re-stamps the editor but never lowers verification.
    const edited = await auth(tokenC, profileA)(request(server()).patch(`/v1/allergies/${allergyId}`)).send({ reactionNote: "Rash" }).expect(200);
    expect(edited.body.provenanceSource).toBe("caregiver_entered");
    expect(edited.body.verification).toBe("patient_confirmed");
    const audit = await prisma.auditEvent.findFirst({ where: { action: "allergy.updated", entityId: allergyId, actorType: "caregiver" } });
    expect(audit).toBeTruthy();
  });

  // ───────────────────────── Organization merge ─────────────────────────

  it("merges an organization: repoints practitioners, immunizations, encounters; soft-deletes with mergedIntoId", async () => {
    const encounter = await prisma.encounter.create({
      data: { patientProfileId: profileA, kind: "outpatient", startedAt: new Date("2025-10-02T04:30:00Z"), organizationId: orgA1, recordedByUserId: (await prisma.patientProfile.findUniqueOrThrow({ where: { id: profileA } })).ownerUserId },
      select: { id: true },
    });
    const linked = await auth(tokenA, profileA)(request(server()).delete(`/v1/organizations/${orgA1}`));
    expect(linked.status).toBe(400);

    const merged = await auth(tokenA, profileA)(request(server()).post(`/v1/organizations/${orgA1}/merge`)).send({ intoId: orgA2 }).expect(201);
    expect(merged.body.id).toBe(orgA2);
    expect(merged.body.practitionerCount).toBe(1);
    expect(merged.body.encounterCount).toBe(1);

    expect((await prisma.practitioner.findUniqueOrThrow({ where: { id: practitionerId } })).organizationId).toBe(orgA2);
    expect((await prisma.immunization.findUniqueOrThrow({ where: { id: immunizationId } })).organizationId).toBe(orgA2);
    expect((await prisma.encounter.findUniqueOrThrow({ where: { id: encounter.id } })).organizationId).toBe(orgA2);
    const source = await prisma.organization.findUniqueOrThrow({ where: { id: orgA1 } });
    expect(source.mergedIntoId).toBe(orgA2);
    expect(source.deletedAt).not.toBeNull();
    const list = await auth(tokenA, profileA)(request(server()).get("/v1/profiles/current/organizations")).expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([orgA2]);
    expect(await prisma.auditEvent.count({ where: { action: "organization.merged", entityId: orgA1 } })).toBe(1);

    const self = await auth(tokenA, profileA)(request(server()).post(`/v1/organizations/${orgA2}/merge`)).send({ intoId: orgA2 });
    expect(self.status).toBe(400);

    // An unlinked facility can simply be deleted.
    const spare = await auth(tokenA, profileA)(request(server()).post("/v1/profiles/current/organizations")).send({ displayName: "Spare Pharmacy", kind: "pharmacy" }).expect(201);
    await auth(tokenA, profileA)(request(server()).delete(`/v1/organizations/${spare.body.id}`)).expect(204);
    await auth(tokenA, profileA)(request(server()).delete(`/v1/organizations/${spare.body.id}`)).expect(404);
  });

  it("soft-deletes an allergy and an immunization, superseding their events", async () => {
    await auth(tokenA, profileA)(request(server()).delete(`/v1/allergies/${allergyId}`)).expect(204);
    expect(await liveEvents("patient_allergy", allergyId)).toHaveLength(0);
    expect((await allEvents("patient_allergy", allergyId)).length).toBeGreaterThan(0);
    await auth(tokenA, profileA)(request(server()).delete(`/v1/immunizations/${immunizationId}`)).expect(204);
    expect(await liveEvents("immunization", immunizationId)).toHaveLength(0);
    const audits = await prisma.auditEvent.findMany({ where: { action: { in: ["allergy.deleted", "immunization.deleted"] }, entityId: { in: [allergyId, immunizationId] } } });
    expect(audits).toHaveLength(2);
  });
});
