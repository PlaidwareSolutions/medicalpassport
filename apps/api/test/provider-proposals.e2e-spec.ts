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
 * Providers propose, patients accept (ADR-V2-009, docs_v2/06 P11–P14).
 * Every org kind, no clinical write before acceptance, accept / reject,
 * provenance on the accepted rows, refill sync from a dispense, follow-up
 * reminders, and hazard H-34 on the discharge transition.
 */
describe("Provider proposals e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  const PATIENT = "+919000001301";
  const CLINIC = "+919000001302";
  const PHARMACY = "+919000001303";
  const LAB = "+919000001304";
  const HOSPITAL = "+919000001305";

  const orgs: Record<string, { id: string; token: string; linkId: string }> = {};
  let patientToken: string;
  let profileId: string;
  let metforminId: string;
  let atorvastatinId: string;

  async function counts() {
    return {
      medications: await prisma.patientMedication.count({ where: { patientProfileId: profileId } }),
      reconciliations: await prisma.medicationReconciliation.count({ where: { patientProfileId: profileId } }),
      prescriptions: await prisma.prescription.count({ where: { patientProfileId: profileId } }),
      encounters: await prisma.encounter.count({ where: { patientProfileId: profileId } }),
      dispenses: await prisma.medicationDispense.count({ where: { patientProfileId: profileId } }),
      reports: await prisma.diagnosticReport.count({ where: { patientProfileId: profileId } }),
      changes: await prisma.medicationChange.count({ where: { patientMedication: { patientProfileId: profileId } } }),
      events: await prisma.healthEvent.count({ where: { patientProfileId: profileId } }),
    };
  }

  async function mintLink(kind: keyof typeof orgs, sections: string[] = ["medications", "allergies", "reports"]) {
    await stepUp(server(), patientToken);
    const minted = await authHeaders(patientToken, profileId)(request(server()).post("/v1/profiles/current/onboarding-tokens"))
      .send({ sections, expiresIn: "1h" })
      .expect(201);
    const link = await authHeaders(orgs[kind]!.token)(request(server()).post("/v1/provider/patients/onboard"))
      .send({ qrToken: minted.body.token })
      .expect(201);
    return link.body.linkId as string;
  }

  const propose = (kind: string, route: string, body: object) =>
    authHeaders(orgs[kind]!.token)(request(server()).post(`/v1/provider/patients/${orgs[kind]!.linkId}/${route}`)).send(body);

  const accept = (id: string, body: object = {}) =>
    authHeaders(patientToken, profileId)(request(server()).post(`/v1/proposals/${id}/accept`)).send(body);

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
      ["hospital", "hospital", HOSPITAL, "Central Hospital"],
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
    const med = (name: string) =>
      authHeaders(patientToken, profileId)(request(server()).post("/v1/profiles/current/medications"))
        .send({ enteredName: name, source: "manual", quantityOnHand: 10, instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
        .expect(201);
    metforminId = (await med("Metformin 500")).body.id;
    atorvastatinId = (await med("Atorvastatin 10")).body.id;
    for (const key of ["clinic", "pharmacy", "lab", "hospital"] as const) orgs[key]!.linkId = await mintLink(key);
  }, 90000);

  afterAll(async () => {
    await app.close();
  });

  const reconciliationBody = () => ({
    notes: "Annual review",
    practitionerName: "Dr Mehta",
    lines: [
      { decision: "START", proposedName: "Amlodipine 5", proposedInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } },
      { decision: "CONTINUE", patientMedicationId: metforminId },
      { decision: "STOP", patientMedicationId: atorvastatinId, reasonText: "LDL at target" },
    ],
  });

  it("the organization kind decides which proposals it may send", async () => {
    expect((await propose("pharmacy", "reconciliations", reconciliationBody()).expect(403)).body.code).toBe("forbidden");
    await propose("clinic", "dispenses", { medicineName: "x", dispensedAt: new Date().toISOString(), quantity: 1, unit: "tablet" }).expect(403);
    await propose("clinic", "discharge", { admittedAt: "2026-08-01", dischargedAt: "2026-08-03", lines: [{ decision: "CONTINUE", patientMedicationId: metforminId }] }).expect(403);
    await propose("lab", "prescriptions", { items: [{ enteredName: "x" }] }).expect(403);
    await propose("clinic", "diagnostic-reports", { title: "CBC" }).expect(403);
    expect(await prisma.providerProposal.count()).toBe(0);
  });

  it("provenance is never client-supplied, and lines may only name the patient's own medicines", async () => {
    const res = await propose("clinic", "reconciliations", { ...reconciliationBody(), provenanceSource: "clinic_entered" }).expect(400);
    expect(res.body.code).toBe("provenance_not_client_settable");
    const foreign = await propose("clinic", "reconciliations", {
      lines: [{ decision: "STOP", patientMedicationId: "00000000-0000-0000-0000-000000000001" }],
    }).expect(400);
    expect(foreign.body.code).toBe("validation_failed");
    // A link that does not share medicines cannot refer to them by id.
    const narrow = await mintLink("clinic", ["allergies"]);
    await authHeaders(orgs.clinic!.token)(request(server()).post(`/v1/provider/patients/${narrow}/reconciliations`))
      .send({ lines: [{ decision: "CONTINUE", patientMedicationId: metforminId }] })
      .expect(403);
    expect(await prisma.providerProposal.count()).toBe(0);
  });

  let reconciliationProposalId: string;

  it("a clinic reconciliation is stored as a proposal and writes nothing clinical", async () => {
    const before = await counts();
    const res = await propose("clinic", "reconciliations", reconciliationBody()).expect(201);
    reconciliationProposalId = res.body.id;
    expect(res.body).toMatchObject({ kind: "reconciliation", status: "proposed", organization: { id: orgs.clinic!.id, kind: "clinic" } });
    expect(await counts()).toEqual(before);
    expect((await prisma.patientMedication.findUniqueOrThrow({ where: { id: atorvastatinId } })).status).toBe("current");
    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.proposal_created", entityId: res.body.id } });
    expect(audit?.context).toMatchObject({ organizationId: orgs.clinic!.id, kind: "reconciliation" });

    const inbox = await authHeaders(patientToken, profileId)(request(server()).get("/v1/profiles/current/proposals")).expect(200);
    expect(inbox.body.items.map((p: { id: string }) => p.id)).toEqual([reconciliationProposalId]);
    expect(inbox.body.nextCursor).toBeNull();
    const one = await authHeaders(patientToken, profileId)(request(server()).get(`/v1/proposals/${reconciliationProposalId}`)).expect(200);
    expect(one.body.payload.lines).toHaveLength(3);
    const mine = await authHeaders(orgs.clinic!.token)(request(server()).get(`/v1/provider/patients/${orgs.clinic!.linkId}/proposals`)).expect(200);
    expect(mine.body.items[0]).toMatchObject({ id: reconciliationProposalId, status: "proposed" });
    // other organizations never see it
    await authHeaders(orgs.pharmacy!.token)(request(server()).get(`/v1/provider/proposals/${reconciliationProposalId}`)).expect(404);
  });

  it("accepting is a step-up operation; acceptance applies the lines with the clinic's provenance", async () => {
    const cold = await patientSignIn(server(), PATIENT);
    expect((await authHeaders(cold, profileId)(request(server()).post(`/v1/proposals/${reconciliationProposalId}/accept`)).send({}).expect(403)).body.code).toBe(
      "step_up_required",
    );

    await stepUp(server(), patientToken);
    const before = await counts();
    const res = await accept(reconciliationProposalId).expect(201);
    expect(res.body).toMatchObject({ status: "accepted", resultingEntityType: "medication_reconciliation", applied: { started: 1, continued: 1, stopped: 1, declined: 0 } });

    const after = await counts();
    expect(after.medications).toBe(before.medications + 1);
    expect(after.reconciliations).toBe(before.reconciliations + 1);

    const amlodipine = await prisma.patientMedication.findFirstOrThrow({ where: { patientProfileId: profileId, enteredName: "Amlodipine 5" } });
    expect(amlodipine).toMatchObject({
      status: "current",
      provenanceSource: "clinic_entered",
      verification: "provider_verified",
      sourceOrganizationId: orgs.clinic!.id,
    });
    const stopped = await prisma.patientMedication.findUniqueOrThrow({ where: { id: atorvastatinId } });
    expect(stopped).toMatchObject({ status: "stopped", statusReason: "LDL at target" });
    expect((await prisma.patientMedication.findUniqueOrThrow({ where: { id: metforminId } })).status).toBe("current");

    const reconciliation = await prisma.medicationReconciliation.findFirstOrThrow({ where: { id: res.body.resultingEntityId }, include: { lines: true } });
    expect(reconciliation).toMatchObject({ status: "applied", organizationId: orgs.clinic!.id, decidedByUserId: expect.any(String) });
    expect(reconciliation.lines.map((l) => [l.decision, l.accepted])).toEqual([
      ["add", true],
      ["continue", true],
      ["stop", true],
    ]);
    expect(reconciliation.lines[0]!.patientMedicationId).toBe(amlodipine.id);

    expect(await prisma.medicationChange.count({ where: { patientMedicationId: atorvastatinId, change: "reconciled_stop" } })).toBe(1);
    expect(await prisma.medicationChange.count({ where: { patientMedicationId: metforminId, change: "reconciled_continue" } })).toBe(1);
    // one event for the reconciliation itself; the CONTINUE line projects as a reconciliation-kind medication event too
    expect(await prisma.healthEvent.count({ where: { patientProfileId: profileId, kind: "reconciliation", entityType: "medication_reconciliation" } })).toBe(1);
    expect(await prisma.healthEvent.count({ where: { patientProfileId: profileId, kind: "reconciliation", entityType: "medication_change" } })).toBe(1);
    expect(await prisma.healthEvent.count({ where: { entityId: atorvastatinId, kind: "medicine_stopped" } })).toBe(0);
    expect(await prisma.healthEvent.count({ where: { patientProfileId: profileId, kind: "medicine_stopped" } })).toBe(1);

    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.proposal_accepted", entityId: reconciliationProposalId } });
    expect(audit?.context).toMatchObject({ organizationId: orgs.clinic!.id, kind: "reconciliation" });
    expect(audit?.actorType).toBe("patient");

    // provider sees the status
    const seen = await authHeaders(orgs.clinic!.token)(request(server()).get(`/v1/provider/proposals/${reconciliationProposalId}`)).expect(200);
    expect(seen.body.status).toBe("accepted");
    await awaitReadAudits();
    expect(await prisma.auditEvent.count({ where: { action: "provider.proposal_viewed" } })).toBe(1);

    // a decision is final
    expect((await accept(reconciliationProposalId).expect(400)).body.code).toBe("invalid_status_transition");
  });

  it("rejecting an encounter proposal records the decision and writes no encounter", async () => {
    const before = await counts();
    const res = await propose("clinic", "encounters", { kind: "outpatient", startedAt: "2026-09-01T04:30:00.000Z", reasonText: "Follow-up" }).expect(201);
    const rejected = await authHeaders(patientToken, profileId)(request(server()).post(`/v1/proposals/${res.body.id}/reject`))
      .send({ reason: "I was not there" })
      .expect(201);
    expect(rejected.body.status).toBe("rejected");
    expect(await counts()).toEqual(before);
    expect((await prisma.providerProposal.findUniqueOrThrow({ where: { id: res.body.id } })).status).toBe("rejected");
    const audit = await prisma.auditEvent.findFirst({ where: { action: "provider.proposal_rejected", entityId: res.body.id } });
    expect(audit?.context).toMatchObject({ organizationId: orgs.clinic!.id, hasReason: true });
    await authHeaders(patientToken, profileId)(request(server()).post(`/v1/proposals/${res.body.id}/reject`)).send({}).expect(400);
    const inbox = await authHeaders(patientToken, profileId)(request(server()).get("/v1/profiles/current/proposals?status=proposed")).expect(200);
    expect(inbox.body.items).toHaveLength(0);
  });

  it("an accepted encounter with a follow-up date creates a follow-up reminder", async () => {
    const res = await propose("clinic", "encounters", {
      kind: "outpatient",
      startedAt: "2026-09-02T04:30:00.000Z",
      practitionerName: "Dr Mehta",
      diagnosisText: "Hypertension",
      followUpOn: "2026-10-02",
    }).expect(201);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    const encounter = await prisma.encounter.findUniqueOrThrow({ where: { id: accepted.body.resultingEntityId } });
    expect(encounter).toMatchObject({
      kind: "outpatient",
      organizationId: orgs.clinic!.id,
      sourceOrganizationId: orgs.clinic!.id,
      provenanceSource: "clinic_entered",
      verification: "provider_verified",
      diagnosisText: "Hypertension",
    });
    expect(encounter.practitionerId).not.toBeNull();
    const followUp = await prisma.testDueSchedule.findFirst({ where: { patientProfileId: profileId, diagnosticKind: "follow_up" } });
    expect(followUp).toMatchObject({ label: "Follow-up visit — Sunrise Clinic", status: "pending" });
    expect(followUp!.dueOn.toISOString().slice(0, 10)).toBe("2026-10-02");
  });

  it("an accepted prescription lands its items in the confirmation queue as clinic_entered", async () => {
    const before = await counts();
    const res = await propose("clinic", "prescriptions", {
      practitionerName: "Dr Mehta",
      prescribedAt: "2026-09-02",
      diagnosisText: "Hypertension",
      items: [
        { enteredName: "Telmisartan 40", doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD", durationDays: 30 },
        { enteredName: "Aspirin 75", instructionsText: "after food" },
      ],
    }).expect(201);
    expect(await counts()).toEqual(before);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    expect(accepted.body.resultingEntityType).toBe("prescription");
    const prescription = await prisma.prescription.findUniqueOrThrow({ where: { id: accepted.body.resultingEntityId }, include: { items: true, practitioner: true } });
    expect(prescription).toMatchObject({ provenanceSource: "clinic_entered", verification: "provider_verified", sourceOrganizationId: orgs.clinic!.id });
    expect(prescription.practitioner?.displayName).toBe("Dr Mehta");
    expect(prescription.items.map((i) => [i.enteredName, i.provenanceSource, i.startedMedicationId])).toEqual([
      ["Telmisartan 40", "clinic_entered", null],
      ["Aspirin 75", "clinic_entered", null],
    ]);
    // Items are not medicines until the patient starts them (the existing flow).
    expect((await counts()).medications).toBe(before.medications);
    const queue = await authHeaders(patientToken, profileId)(request(server()).get(`/v1/prescriptions/${prescription.id}/items`)).expect(200);
    expect(queue.body.items).toHaveLength(2);
    expect(await prisma.healthEvent.count({ where: { entityId: prescription.id, kind: "prescription" } })).toBe(1);
  });

  it("an accepted pharmacy dispense records the refill and syncs the refill plan", async () => {
    const before = await counts();
    const res = await propose("pharmacy", "dispenses", {
      patientMedicationId: metforminId,
      medicineName: "Metformin 500",
      dispensedAt: "2026-09-03T05:00:00.000Z",
      quantity: 30,
      unit: "tablet",
      daysSupply: 30,
    }).expect(201);
    expect(await counts()).toEqual(before);
    expect(await prisma.medicationRefillPlan.count({ where: { patientMedicationId: metforminId } })).toBe(0);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    const dispense = await prisma.medicationDispense.findUniqueOrThrow({ where: { id: accepted.body.resultingEntityId } });
    expect(dispense).toMatchObject({
      patientMedicationId: metforminId,
      organizationId: orgs.pharmacy!.id,
      unit: "tablet",
      daysSupply: 30,
      provenanceSource: "pharmacy_entered",
      verification: "provider_verified",
    });
    expect(Number(dispense.quantity)).toBe(30);
    const medication = await prisma.patientMedication.findUniqueOrThrow({ where: { id: metforminId }, include: { refillPlan: true } });
    expect(Number(medication.quantityOnHand)).toBe(40);
    expect(medication.refillPlan).not.toBeNull();
    expect(Number(medication.refillPlan!.quantityOnHand)).toBe(40);
    expect(medication.refillPlan!.projectedRunOutOn).not.toBeNull();
    expect(await prisma.medicationChange.count({ where: { patientMedicationId: metforminId, change: "refilled" } })).toBe(1);
    expect(await prisma.healthEvent.count({ where: { entityId: dispense.id, kind: "dispense" } })).toBe(1);
    const plan = await authHeaders(patientToken, profileId)(request(server()).get(`/v1/medications/${metforminId}/refill-plan`)).expect(200);
    expect(plan.body).toMatchObject({ exists: true, quantityOnHand: "40" });
  });

  it("an accepted laboratory report lands source_authenticated with the lab's own flags", async () => {
    const before = await counts();
    const res = await propose("lab", "diagnostic-reports", {
      kind: "laboratory",
      title: "Fasting glucose",
      reportedAt: "2026-09-04T03:00:00.000Z",
      results: [
        { analyteKey: "fasting_glucose", enteredValueText: "132", enteredUnit: "mg/dL", referenceLow: 70, referenceHigh: 100, interpretation: "high" },
        { analyteKey: "hemoglobin", enteredValueText: "13.2", enteredUnit: "g/dL" },
      ],
    }).expect(201);
    expect(await counts()).toEqual(before);
    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    const report = await prisma.diagnosticReport.findUniqueOrThrow({ where: { id: accepted.body.resultingEntityId }, include: { results: true } });
    expect(report).toMatchObject({
      title: "Fasting glucose",
      organizationId: orgs.lab!.id,
      sourceOrganizationId: orgs.lab!.id,
      facilityNameText: "City Diagnostics",
      provenanceSource: "lab_imported",
      verification: "source_authenticated",
    });
    expect(report.results).toHaveLength(2);
    const glucose = report.results.find((r) => r.analyteKey === "fasting_glucose")!;
    expect(glucose).toMatchObject({ interpretation: "high", provenanceSource: "lab_imported", verification: "source_authenticated", sourceOrganizationId: orgs.lab!.id });
    expect(Number(glucose.valueNumeric)).toBe(132);
    expect(await prisma.healthEvent.count({ where: { entityId: report.id } })).toBeGreaterThan(0);
  });

  it("H-34: a discharge transition never proposes a stopped medicine as current", async () => {
    const amlodipine = await prisma.patientMedication.findFirstOrThrow({ where: { patientProfileId: profileId, enteredName: "Amlodipine 5" } });
    const before = await counts();
    const res = await propose("hospital", "discharge", {
      admittedAt: "2026-09-05T02:00:00.000Z",
      dischargedAt: "2026-09-08T06:00:00.000Z",
      diagnosisText: "Acute coronary syndrome",
      summaryText: "Stented LAD. Stop metformin pending renal review.",
      practitionerName: "Dr Rao",
      followUpOn: "2026-09-22",
      lines: [
        { decision: "STOP", patientMedicationId: metforminId, reasonText: "Renal review pending" },
        { decision: "START", proposedName: "Clopidogrel 75", proposedInstruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } },
        { decision: "CONTINUE", patientMedicationId: amlodipine.id },
      ],
    }).expect(201);
    // A discharge summary carries no "current medicines" list — only decided lines.
    const bad = await propose("hospital", "discharge", {
      admittedAt: "2026-09-05",
      dischargedAt: "2026-09-08",
      lines: [{ patientMedicationId: metforminId }],
    }).expect(400);
    expect(bad.body.code).toBe("validation_failed");
    expect(await counts()).toEqual(before);

    await stepUp(server(), patientToken);
    const accepted = await accept(res.body.id).expect(201);
    expect(accepted.body.applied).toMatchObject({ started: 1, stopped: 1, continued: 1, declined: 0 });

    const after = await counts();
    // exactly one medicine came out of the transition: the START line, never the STOP line
    expect(after.medications).toBe(before.medications + 1);
    expect(after.encounters).toBe(before.encounters + 1);
    expect((await prisma.patientMedication.findUniqueOrThrow({ where: { id: metforminId } })).status).toBe("stopped");
    const clopidogrel = await prisma.patientMedication.findFirstOrThrow({ where: { patientProfileId: profileId, enteredName: "Clopidogrel 75" } });
    expect(clopidogrel).toMatchObject({ status: "current", provenanceSource: "clinic_entered", verification: "provider_verified", sourceOrganizationId: orgs.hospital!.id });
    expect((await prisma.patientMedication.findUniqueOrThrow({ where: { id: amlodipine.id } })).status).toBe("current");
    const current = await prisma.patientMedication.findMany({ where: { patientProfileId: profileId, status: "current" } });
    expect(current.map((m) => m.enteredName).sort()).toEqual(["Amlodipine 5", "Clopidogrel 75"]);

    const encounter = await prisma.encounter.findUniqueOrThrow({ where: { id: accepted.body.resultingEntityId } });
    expect(encounter).toMatchObject({ kind: "inpatient", organizationId: orgs.hospital!.id, diagnosisText: "Acute coronary syndrome", provenanceSource: "clinic_entered" });
    expect(encounter.endedAt?.toISOString()).toBe("2026-09-08T06:00:00.000Z");
    const reconciliation = await prisma.medicationReconciliation.findFirstOrThrow({ where: { encounterId: encounter.id }, include: { lines: true } });
    expect(reconciliation.status).toBe("applied");
    expect(reconciliation.lines.map((l) => l.decision)).toEqual(["stop", "add", "continue"]);
    expect(await prisma.healthEvent.count({ where: { entityId: encounter.id, kind: "discharge" } })).toBe(1);
    expect(await prisma.healthEvent.count({ where: { entityId: encounter.id, kind: "hospital_admission" } })).toBeGreaterThanOrEqual(0);
    expect(await prisma.testDueSchedule.count({ where: { patientProfileId: profileId, diagnosticKind: "follow_up", label: "Follow-up visit — Central Hospital" } })).toBe(1);
  });

  it("individual lines can be declined (H-43); declining every line is not an accept", async () => {
    const amlodipine = await prisma.patientMedication.findFirstOrThrow({ where: { patientProfileId: profileId, enteredName: "Amlodipine 5" } });
    const clopidogrel = await prisma.patientMedication.findFirstOrThrow({ where: { patientProfileId: profileId, enteredName: "Clopidogrel 75" } });
    const res = await propose("clinic", "reconciliations", {
      lines: [
        { decision: "STOP", patientMedicationId: amlodipine.id, reasonText: "BP low" },
        { decision: "CONTINUE", patientMedicationId: clopidogrel.id },
      ],
    }).expect(201);
    await stepUp(server(), patientToken);
    expect((await accept(res.body.id, { declinedLines: [0, 1] }).expect(400)).body.code).toBe("validation_failed");
    const accepted = await accept(res.body.id, { declinedLines: [0] }).expect(201);
    expect(accepted.body.applied).toMatchObject({ stopped: 0, continued: 1, declined: 1 });
    expect((await prisma.patientMedication.findUniqueOrThrow({ where: { id: amlodipine.id } })).status).toBe("current");
    const lines = await prisma.medicationReconciliationLine.findMany({ where: { reconciliationId: accepted.body.resultingEntityId }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => l.accepted)).toEqual([false, true]);
  });

  it("a revoked link stops proposals; the inbox pages by cursor", async () => {
    await stepUp(server(), patientToken);
    await authHeaders(patientToken, profileId)(request(server()).post(`/v1/provider-links/${orgs.hospital!.linkId}/revoke`)).expect(201);
    await propose("hospital", "encounters", { kind: "inpatient", startedAt: "2026-09-10T02:00:00.000Z" }).expect(404);

    const page1 = await authHeaders(patientToken, profileId)(request(server()).get("/v1/profiles/current/proposals?limit=2")).expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBe(page1.body.items[1].id);
    const page2 = await authHeaders(patientToken, profileId)(request(server()).get(`/v1/profiles/current/proposals?limit=2&cursor=${page1.body.nextCursor}`)).expect(200);
    expect(page2.body.items.map((p: { id: string }) => p.id)).not.toContain(page1.body.items[0].id);
    const all = await authHeaders(patientToken, profileId)(request(server()).get("/v1/profiles/current/proposals")).expect(200);
    expect(all.body.items.map((p: { kind: string; status: string }) => `${p.kind}:${p.status}`).sort()).toEqual(
      [
        "reconciliation:accepted",
        "reconciliation:accepted",
        "encounter:rejected",
        "encounter:accepted",
        "prescription:accepted",
        "dispense:accepted",
        "diagnostic_report:accepted",
        "discharge_transition:accepted",
      ].sort(),
    );
  });
});
