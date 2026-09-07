import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PROVIDER_LINK_SECTIONS } from "@medpass/validation";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { stepUp } from "./helpers/step-up";
import { authHeaders, patientSignIn, providerSignIn, seedOrganization } from "./helpers/provider";

/**
 * What a proposal is worth once it lands (2026-09-07 portal QA):
 *
 *  - a dispense may only move the patient's supply counter when its unit is
 *    the one the patient counts in (docs_v2/10 — the refill projection is
 *    patient-facing);
 *  - a laboratory report keeps the dates the proposal carried, instead of
 *    reading "Date not recorded" beside its own printed dates;
 *  - the Doctor Snapshot answers every section a provider link is allowed to
 *    advertise, so "Shared: …" is never a promise the payload cannot keep;
 *  - the organization that sent a proposal sees what the patient decided per
 *    line, and their reason when they gave one (H-43);
 *  - a malformed id on a provider route reads as "not found", not a 500.
 */
describe("Provider proposal fidelity e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  const PATIENT = "+919000001401";
  const CLINIC = "+919000001402";
  const PHARMACY = "+919000001403";
  const LAB = "+919000001404";

  const orgs: Record<"clinic" | "pharmacy" | "lab", { id: string; token: string; linkId: string }> = {
    clinic: { id: "", token: "", linkId: "" },
    pharmacy: { id: "", token: "", linkId: "" },
    lab: { id: "", token: "", linkId: "" },
  };
  let patientToken: string;
  let profileId: string;
  let metforminId: string;
  let syrupId: string;

  const patient = () => authHeaders(patientToken, profileId);

  async function mintLink(kind: keyof typeof orgs, sections: readonly string[]) {
    await stepUp(server(), patientToken);
    const minted = await patient()(request(server()).post("/v1/profiles/current/onboarding-tokens"))
      .send({ sections, expiresIn: "1h" })
      .expect(201);
    const link = await authHeaders(orgs[kind].token)(request(server()).post("/v1/provider/patients/onboard"))
      .send({ qrToken: minted.body.token })
      .expect(201);
    return link.body.linkId as string;
  }

  const propose = (kind: keyof typeof orgs, route: string, body: object) =>
    authHeaders(orgs[kind].token)(request(server()).post(`/v1/provider/patients/${orgs[kind].linkId}/${route}`)).send(body);

  const accept = (id: string, body: object = {}) => patient()(request(server()).post(`/v1/proposals/${id}/accept`)).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, provider_proposals, provider_patient_links,
        medication_reconciliation_lines, medication_reconciliations, medication_dispenses, test_due_schedules,
        organization_members, organizations, share_access_events, share_links, share_packages,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
    for (const [key, kind, phone, name] of [
      ["clinic", "clinic", CLINIC, "Sunrise Clinic"],
      ["pharmacy", "pharmacy", PHARMACY, "Corner Pharmacy"],
      ["lab", "laboratory", LAB, "City Diagnostics"],
    ] as const) {
      const { organizationId } = await seedOrganization({ kind, displayName: name, ownerPhone: phone });
      orgs[key] = { id: organizationId, token: await providerSignIn(server(), phone), linkId: "" };
    }
    patientToken = await patientSignIn(server(), PATIENT);
    profileId = (
      await authHeaders(patientToken)(request(server()).post("/v1/profiles"))
        .send({ displayName: "Ravi Kumar", yearOfBirth: 1960, preferredLocale: "en" })
        .expect(201)
    ).body.id;

    const med = (enteredName: string, instruction: object) =>
      patient()(request(server()).post("/v1/profiles/current/medications"))
        .send({ enteredName, source: "manual", quantityOnHand: 10, instruction })
        .expect(201);
    metforminId = (await med("Metformin 500", { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" })).body.id;
    syrupId = (await med("Ambroxol syrup", { doseQuantity: 5, doseUnit: "ml", frequencyCode: "TDS" })).body.id;

    // Home-diary rows so the snapshot sections carry real numbers, not just keys.
    await patient()(request(server()).post("/v1/profiles/current/blood-pressure-readings"))
      .send({ measuredAt: new Date(Date.now() - 86400000).toISOString(), systolic: 138, diastolic: 84, pulseBpm: 72 })
      .expect(201);
    await patient()(request(server()).post("/v1/profiles/current/glucose-readings"))
      .send({ measuredAt: new Date(Date.now() - 86400000).toISOString(), context: "before_breakfast", valueMgDl: 126 })
      .expect(201);

    orgs.clinic.linkId = await mintLink("clinic", PROVIDER_LINK_SECTIONS);
    orgs.pharmacy.linkId = await mintLink("pharmacy", ["medications"]);
    orgs.lab.linkId = await mintLink("lab", ["reports"]);
  }, 90000);

  afterAll(async () => {
    await app.close();
  });

  // ───────────────────── a dispense never mixes units ─────────────────────

  it("refuses a dispense in a unit the patient does not count in, and says which two units did not match", async () => {
    const res = await propose("pharmacy", "dispenses", {
      patientMedicationId: metforminId,
      medicineName: "Metformin 500",
      dispensedAt: "2026-09-03T05:00:00.000Z",
      quantity: 30,
      unit: "strip",
    }).expect(400);
    expect(res.body.code).toBe("validation_failed");
    expect(res.body.title).toContain("tablet");
    expect(res.body.title).toContain("strip");
    // Nothing was stored: the pharmacist is told now, not the patient later.
    expect(await prisma.providerProposal.count({ where: { organizationId: orgs.pharmacy.id } })).toBe(0);

    // ml into a tablet counter is refused for the same reason, in both directions.
    await propose("pharmacy", "dispenses", {
      patientMedicationId: metforminId,
      medicineName: "Metformin 500",
      dispensedAt: "2026-09-03T05:00:00.000Z",
      quantity: 100,
      unit: "ml",
    }).expect(400);
    await propose("pharmacy", "dispenses", {
      patientMedicationId: syrupId,
      medicineName: "Ambroxol syrup",
      dispensedAt: "2026-09-03T05:00:00.000Z",
      quantity: 2,
      unit: "bottle",
    }).expect(400);

    // The supply is untouched either way.
    expect(Number((await prisma.patientMedication.findUniqueOrThrow({ where: { id: metforminId } })).quantityOnHand)).toBe(10);
  });

  it("accepts a comparable spelling of the same unit and adds it to the supply", async () => {
    const res = await propose("pharmacy", "dispenses", {
      patientMedicationId: metforminId,
      medicineName: "Metformin 500",
      dispensedAt: "2026-09-03T05:00:00.000Z",
      quantity: 30,
      unit: "Tabs",
      daysSupply: 30,
    }).expect(201);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    expect(accepted.body.applied).toMatchObject({ quantity: 30, unit: "Tabs", supplyUpdated: true });
    const medication = await prisma.patientMedication.findUniqueOrThrow({ where: { id: metforminId }, include: { refillPlan: true } });
    expect(Number(medication.quantityOnHand)).toBe(40);
    expect(Number(medication.refillPlan!.quantityOnHand)).toBe(40);
    // and the dispense keeps the pharmacy's own words for the unit
    const dispense = await prisma.medicationDispense.findUniqueOrThrow({ where: { id: accepted.body.resultingEntityId } });
    expect(dispense.unit).toBe("Tabs");
  });

  it("a dispense for a medicine the patient does not track is taken as given", async () => {
    const res = await propose("pharmacy", "dispenses", {
      patientMedicationId: null,
      medicineName: "Paracetamol 500",
      dispensedAt: "2026-09-03T06:00:00.000Z",
      quantity: 20,
      unit: "strip",
    }).expect(201);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    expect(accepted.body.applied).toMatchObject({ medicationId: null, supplyUpdated: false });
  });

  // ───────────────────── a report keeps its dates ─────────────────────

  it("a laboratory report is filed on the date the proposal carried, preferring the collection date", async () => {
    const res = await propose("lab", "diagnostic-reports", {
      kind: "laboratory",
      title: "HbA1c",
      reportedAt: "2026-09-05T09:00:00.000Z",
      specimenCollectedAt: "2026-09-04T03:30:00.000Z",
      results: [{ analyteKey: "hba1c", enteredValueText: "6.9", enteredUnit: "%" }],
    }).expect(201);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    const report = await prisma.diagnosticReport.findUniqueOrThrow({ where: { id: accepted.body.resultingEntityId } });
    // testedAt is the display date (@db.Date), so only the day survives — which is the point: it is no longer null.
    expect(report.testedAt?.toISOString().slice(0, 10)).toBe("2026-09-04");
    expect(report.specimenCollectedAt?.toISOString()).toBe("2026-09-04T03:30:00.000Z");
    expect(report.reportedAt?.toISOString()).toBe("2026-09-05T09:00:00.000Z");
  });

  it("with no collection date the report date is used — never nothing", async () => {
    const res = await propose("lab", "diagnostic-reports", {
      kind: "laboratory",
      title: "Lipid profile",
      reportedAt: "2026-09-06T09:00:00.000Z",
      results: [{ analyteKey: "total_cholesterol", enteredValueText: "190", enteredUnit: "mg/dL" }],
    }).expect(201);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    const report = await prisma.diagnosticReport.findUniqueOrThrow({ where: { id: accepted.body.resultingEntityId } });
    expect(report.testedAt?.toISOString().slice(0, 10)).toBe("2026-09-06");
  });

  // ───────────────────── the snapshot answers what it advertises ─────────────────────

  it("the snapshot carries a section for every section the link advertises", async () => {
    const res = await authHeaders(orgs.clinic.token)(request(server()).get(`/v1/provider/patients/${orgs.clinic.linkId}/snapshot`)).expect(200);
    expect(res.body.sections).toEqual([...PROVIDER_LINK_SECTIONS]);

    /** Section name on the link → the key the snapshot answers it with. */
    const KEY_FOR_SECTION: Record<string, string> = {
      medications: "currentMedications",
      allergies: "allergies",
      conditions: "majorConditions",
      recentChanges: "recentChanges",
      concerns: "unresolvedConcerns",
      glucoseReadings: "glucoseReadings",
      bloodPressureReadings: "bloodPressureReadings",
      weightReadings: "weightReadings",
      checkups: "checkups",
      prescriptions: "prescriptions",
      reports: "latestResults",
      measurements: "measurements",
      documents: "documents",
      encounters: "encounters",
    };
    for (const section of PROVIDER_LINK_SECTIONS) {
      expect({ section, present: res.body[KEY_FOR_SECTION[section]!] !== undefined }).toEqual({ section, present: true });
    }

    // and the numbers are the patient's own, with no judgement attached
    expect(res.body.bloodPressureReadings).toMatchObject({ readingCount: 1, averageSystolic: 138, averageDiastolic: 84 });
    expect(res.body.bloodPressureReadings.recent[0]).toMatchObject({ systolic: 138, diastolic: 84, pulseBpm: 72 });
    expect(res.body.glucoseReadings).toMatchObject({ readingCount: 1, averageMgDl: 126, lowestMgDl: 126, highestMgDl: 126 });
    expect(JSON.stringify(res.body.bloodPressureReadings)).not.toMatch(/high|low|normal|elevated/i);

    // provider-web reads the current instruction's codes so a CONTINUE line reads like a START line
    const metformin = res.body.currentMedications.find((m: { name: string }) => m.name === "Metformin 500");
    expect(metformin.instruction).toMatchObject({ doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" });
  });

  it("a link that grants two sections answers those two and nothing else", async () => {
    const res = await authHeaders(orgs.lab.token)(request(server()).get(`/v1/provider/patients/${orgs.lab.linkId}/snapshot`)).expect(200);
    expect(res.body.sections).toEqual(["reports"]);
    expect(res.body.latestResults).toBeDefined();
    expect(res.body.bloodPressureReadings).toBeUndefined();
    expect(res.body.glucoseReadings).toBeUndefined();
    expect(res.body.encounters).toBeUndefined();
    expect(res.body.currentMedications).toBeUndefined();
  });

  // ───────────────────── the provider sees the patient's decision ─────────────────────

  it("a partial acceptance tells the clinic which lines the patient declined", async () => {
    const res = await propose("clinic", "reconciliations", {
      lines: [
        { decision: "STOP", patientMedicationId: syrupId, proposedName: "Ambroxol syrup", reasonText: "Cough settled" },
        { decision: "CONTINUE", patientMedicationId: metforminId, proposedName: "Metformin 500" },
      ],
    }).expect(201);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id, { declinedLines: [0] }).expect(201);
    expect(accepted.body.declinedLines).toEqual([0]);

    const seen = await authHeaders(orgs.clinic.token)(request(server()).get(`/v1/provider/proposals/${res.body.id}`)).expect(200);
    expect(seen.body).toMatchObject({ status: "accepted", declinedLines: [0], decisionReason: null });
    // the declined line names its medicine, so "which line" is answerable
    expect(seen.body.payload.lines[0]).toMatchObject({ decision: "STOP", proposedName: "Ambroxol syrup" });
    // and the medicine the patient kept is still current
    expect((await prisma.patientMedication.findUniqueOrThrow({ where: { id: syrupId } })).status).toBe("current");
  });

  it("a rejection carries the patient's reason back to the organization that sent it", async () => {
    const res = await propose("clinic", "encounters", { kind: "teleconsult", startedAt: "2026-09-07T04:30:00.000Z" }).expect(201);
    await patient()(request(server()).post(`/v1/proposals/${res.body.id}/reject`))
      .send({ reason: "That was my wife's appointment, not mine" })
      .expect(201);

    const seen = await authHeaders(orgs.clinic.token)(request(server()).get(`/v1/provider/proposals/${res.body.id}`)).expect(200);
    expect(seen.body).toMatchObject({ status: "rejected", decisionReason: "That was my wife's appointment, not mine", declinedLines: [] });
    // the audit row still records only that a reason existed, never the text
    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.proposal_rejected", entityId: res.body.id } });
    expect(audit?.context).toMatchObject({ hasReason: true });
    expect(JSON.stringify(audit?.context)).not.toContain("wife");
  });

  // ───────────────────── malformed ids ─────────────────────

  it("a malformed id on a provider route is a 404, never a 500", async () => {
    for (const path of [
      "/v1/provider/proposals/not-a-uuid",
      "/v1/provider/patients/not-a-uuid/snapshot",
      "/v1/provider/patients/not-a-uuid/proposals",
    ]) {
      const res = await authHeaders(orgs.clinic.token)(request(server()).get(path)).expect(404);
      expect(res.body.code).toBe("not_found");
    }
  });
});
