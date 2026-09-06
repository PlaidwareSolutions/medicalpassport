import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { phoneDigest } from "../src/common/crypto";
import { stepUp } from "./helpers/step-up";

interface Entry {
  fullUrl?: string;
  resource: { resourceType: string; id?: string; meta?: { profile?: string[] }; [k: string]: unknown };
}

/**
 * FHIR export end to end (docs_v2/05 §10, docs_v2/08 §2 / §8):
 * `GET profiles/current/fhir/export?ig=` and `…/fhir/ips` are step-up guarded, audited, scoped
 * on `share_records`, and produce a Bundle built from the profile's canonical rows through
 * `@medpass/fhir`, with every clinical resource accompanied by a Provenance. Rows the serializer
 * refuses (no provenance) and mapping gaps land in `fhir_validation_failures`, never in the body.
 */
describe("FHIR export e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const PHONE = "+919000000521";
  const CAREGIVER_PHONE = "+919000000522";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  let token: string;
  let profileId: string;
  let userId: string;

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

    const signed = await signIn(PHONE, "Asha Demo");
    token = signed.token;
    profileId = signed.profileId;
    userId = signed.userId;
    await seedClinicalRows();
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  const auth = (t: string, pid?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${t}`).set("x-requested-with", "medpass");
    if (pid) req.set("x-profile-id", pid);
    return req;
  };

  async function signIn(phone: string, displayName: string) {
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    const t: string = verify.body.token;
    const profile = await auth(t)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName, yearOfBirth: 1975, preferredLocale: "en" })
      .expect(201);
    return { token: t, profileId: profile.body.id as string, userId: verify.body.user.id as string };
  }

  /** Rows are seeded directly so the export is tested against exact provenance states, not the write paths (covered elsewhere). */
  async function seedClinicalRows() {
    const stamp = { provenanceSource: "user_entered" as const, verification: "patient_confirmed" as const, recordedVia: "pwa", recordedByUserId: userId };
    await prisma.patientAllergy.create({
      data: { patientProfileId: profileId, label: "Penicillin", severity: "severe", reactionNote: "Rash", source: "patient", category: "medication", criticality: "high", codeSystem: "http://snomed.info/sct", code: "373270004", ...stamp },
    });
    // A V1 row the provenance backfill has not reached: no verification → the serializer must refuse it.
    await prisma.patientAllergy.create({ data: { patientProfileId: profileId, label: "Dust", severity: "mild", source: "patient", recordedByUserId: userId } });
    await prisma.patientCondition.create({
      data: { patientProfileId: profileId, label: "Type 2 diabetes mellitus", source: "patient", clinicalStatus: "active", codeSystem: "http://snomed.info/sct", code: "44054006", ...stamp },
    });
    await prisma.patientMedication.create({
      data: {
        patientProfileId: profileId,
        enteredName: "Metformin 500",
        source: "manual",
        status: "current",
        startDate: new Date("2026-08-14"),
        ...stamp,
        instructions: { create: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD", foodInstruction: "after", confirmedByUserId: userId, ...stamp } },
      },
    });
    const report = await prisma.diagnosticReport.create({
      data: { patientProfileId: profileId, kind: "laboratory", title: "HbA1c", status: "final", testedAt: new Date("2026-08-10"), ...stamp },
    });
    await prisma.diagnosticResult.create({
      data: { diagnosticReportId: report.id, patientProfileId: profileId, analyteKey: "hba1c", enteredValueText: "6.8", valueNumeric: 6.8, unit: "%", ...stamp },
    });
    await prisma.diagnosticResult.create({
      data: { diagnosticReportId: report.id, patientProfileId: profileId, analyteKey: "other", analyteLabelText: "Serum Ferritin", enteredValueText: "12", valueNumeric: 12, enteredUnit: "ng/mL", sequence: 2, ...stamp },
    });
    await prisma.observation.create({
      data: { patientProfileId: profileId, concept: "blood_pressure", valueNumeric: 128, valueNumeric2: 82, unit: "mm[Hg]", measuredAt: new Date("2026-09-01T02:15:00Z"), ...stamp },
    });
    // Device-recorded and never confirmed: exported in the full export, omitted from the patient summary.
    await prisma.observation.create({
      data: { patientProfileId: profileId, concept: "body_weight", valueNumeric: 68.4, unit: "kg", measuredAt: new Date("2026-09-01T02:20:00Z"), provenanceSource: "device_recorded", verification: "unverified", recordedVia: "native_android" },
    });
  }

  const entriesOf = (body: { entry?: Entry[] }) => body.entry ?? [];
  const byType = (body: { entry?: Entry[] }, type: string) => entriesOf(body).filter((e) => e.resource.resourceType === type);

  it("requires a fresh step-up (ADR-V2-012)", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/fhir/export")).expect(403);
    expect(res.body.code).toBe("step_up_required");
  });

  it("exports a collection Bundle with every clinical resource plus its Provenance (IG 6.5 default)", async () => {
    await stepUp(app.getHttpServer(), token);
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/fhir/export")).expect(200);
    expect(res.headers["content-type"]).toMatch(/application\/fhir\+json/);
    expect(res.body.resourceType).toBe("Bundle");
    expect(res.body.type).toBe("collection");

    const types = entriesOf(res.body).map((e) => e.resource.resourceType);
    for (const expected of ["Patient", "AllergyIntolerance", "Condition", "MedicationStatement", "DiagnosticReport", "Observation", "Provenance"]) {
      expect(types).toContain(expected);
    }
    // One Provenance per clinical resource, targeting it.
    const clinical = entriesOf(res.body).filter((e) => e.resource.resourceType !== "Provenance");
    const targets = new Set(byType(res.body, "Provenance").flatMap((e) => (e.resource.target as Array<{ reference: string }>).map((t) => t.reference)));
    expect(byType(res.body, "Provenance")).toHaveLength(clinical.length);
    for (const e of clinical) expect(targets.has(`${e.resource.resourceType}/${e.resource.id}`)).toBe(true);

    // The refused V1 row is not in the body; the confirmed one is, as unconfirmed (patient-entered never over-claims).
    const allergies = byType(res.body, "AllergyIntolerance");
    expect(allergies).toHaveLength(1);
    expect((allergies[0]!.resource.code as { text: string }).text).toBe("Penicillin");
    expect((allergies[0]!.resource.verificationStatus as { coding: Array<{ code: string }> }).coding[0]!.code).toBe("unconfirmed");

    // Lab result terminology: LOINC + UCUM from @medpass/terminology.
    const labs = byType(res.body, "Observation").filter((e) => (e.resource.category as Array<{ coding: Array<{ code: string }> }>)[0]!.coding[0]!.code === "laboratory");
    const hba1c = labs.find((e) => (e.resource.code as { coding: Array<{ code: string }> }).coding[0]!.code === "4548-4");
    expect(hba1c).toBeDefined();
    expect(hba1c!.resource.valueQuantity).toEqual({ value: 6.8, unit: "%", system: "http://unitsofmeasure.org", code: "%" });
    const ferritin = labs.find((e) => (e.resource.code as { text: string }).text === "Serum Ferritin");
    expect((ferritin!.resource.code as { coding: Array<{ system: string }> }).coding[0]!.system).toBe("https://medicinepassport.app/CodeSystem/analyte");

    // Blood pressure: vital-signs profile with two components on IG 6.5.
    const bp = byType(res.body, "Observation").find((e) => (e.resource.code as { coding: Array<{ code: string }> }).coding[0]!.code === "85354-9")!;
    expect(bp.resource.meta?.profile).toEqual(["http://hl7.org/fhir/StructureDefinition/vitalsigns"]);
    expect((bp.resource.component as unknown[]).length).toBe(2);
  });

  it("records the refusal and the mapping gap as FhirValidationFailure rows and audits the export", async () => {
    const failures = await prisma.fhirValidationFailure.findMany({ where: { direction: "outbound" }, orderBy: { createdAt: "asc" } });
    expect(failures.some((f) => f.resourceType === "PatientAllergy" && f.path === "PatientAllergy.provenance" && f.severity === "error")).toBe(true);
    expect(failures.some((f) => f.resourceType === "Observation" && f.path === "Observation.code" && f.severity === "warning" && f.message.includes("no LOINC mapping"))).toBe(true);
    expect(failures.every((f) => f.igVersion === "6.5")).toBe(true);
    const audit = await prisma.auditEvent.findFirst({ where: { action: "fhir.exported", patientProfileId: profileId } });
    expect(audit).not.toBeNull();
    expect((audit!.context as { ig: string }).ig).toBe("6.5");
  });

  it("selects the IG folder with ?ig=7.0 (BP gets the v7 ObservationBP profile) and rejects an unknown version", async () => {
    await stepUp(app.getHttpServer(), token);
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/fhir/export").query({ ig: "7.0" })).expect(200);
    const bp = byType(res.body, "Observation").find((e) => (e.resource.code as { coding: Array<{ code: string }> }).coding[0]!.code === "85354-9")!;
    expect(bp.resource.meta?.profile?.[0]).toBe("https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationBP");
    const software = byType(res.body, "Provenance")[0]!.resource.agent as Array<{ who: { identifier?: { value: string } } }>;
    expect(software.at(-1)!.who.identifier!.value).toMatch(/;ig=7\.0$/);
    await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/fhir/export").query({ ig: "5.0" })).expect(400);
  });

  it("is scoped on share_records: a caregiver without that scope gets 403 even after step-up", async () => {
    const caregiver = await signIn(CAREGIVER_PHONE, "Ravi Demo");
    const relationship = await prisma.caregiverRelationship.create({
      data: {
        patientProfileId: profileId,
        caregiverUserId: caregiver.userId,
        invitedPhoneDigest: phoneDigest(CAREGIVER_PHONE),
        relationship: "son",
        status: "active",
        permissions: { create: [{ scope: "view_medications", grantedByUserId: userId }] },
      },
    });
    expect(relationship.id).toBeTruthy();
    await stepUp(app.getHttpServer(), caregiver.token);
    const res = await auth(caregiver.token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/fhir/export")).expect(403);
    expect(res.body.code).toBe("caregiver_scope_missing");
  });

  describe("Indian Patient Summary (Phase 15)", () => {
    it("requires step-up and only accepts IG 7.0", async () => {
      const fresh = await signIn("+919000000523", "Meena Demo");
      await auth(fresh.token, fresh.profileId)(request(app.getHttpServer()).get("/v1/profiles/current/fhir/ips")).expect(403);
      await stepUp(app.getHttpServer(), fresh.token);
      await auth(fresh.token, fresh.profileId)(request(app.getHttpServer()).get("/v1/profiles/current/fhir/ips").query({ ig: "6.5" })).expect(400);
    });

    it("returns a document Bundle whose sections carry only confirmed rows, each with Provenance", async () => {
      await stepUp(app.getHttpServer(), token);
      const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/fhir/ips").query({ ig: "7.0" })).expect(200);
      expect(res.body.type).toBe("document");
      const first = entriesOf(res.body)[0]!.resource;
      expect(first.resourceType).toBe("Composition");
      expect(first.meta?.profile).toEqual(["https://nrces.in/ndhm/fhir/r4/StructureDefinition/IndianPatientSummary"]);
      const sections = first.section as Array<{ code: { coding: Array<{ code: string }> }; entry?: Array<{ reference: string }>; emptyReason?: unknown }>;
      const codes = sections.map((s) => s.code.coding[0]!.code);
      expect(codes).toEqual(["10160-0", "48765-2", "11450-4", "30954-2", "8716-3"]);
      // Vital signs: the confirmed BP only — the unverified device weight is omitted.
      const vitals = sections.find((s) => s.code.coding[0]!.code === "8716-3")!;
      expect(vitals.entry).toHaveLength(1);
      expect(byType(res.body, "Observation").some((e) => (e.resource.code as { coding: Array<{ code: string }> }).coding[0]!.code === "29463-7")).toBe(false);
      const clinical = entriesOf(res.body).filter((e) => e.resource.resourceType !== "Provenance");
      expect(byType(res.body, "Provenance")).toHaveLength(clinical.length);
      const audit = await prisma.auditEvent.findFirst({ where: { action: "fhir.patient_summary_exported", patientProfileId: profileId } });
      expect(audit).not.toBeNull();
    });
  });
});
