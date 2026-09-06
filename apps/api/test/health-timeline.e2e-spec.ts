import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { localIso } from "@medpass/health-events";
import { stepUp } from "./helpers/step-up";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Unified health timeline (docs_v2/05 §3, ADR-V2-008, WP P1-3): every
 * clinical write path projects an event in its own transaction, the read
 * model comes back newest first with the patient's local clock, provenance
 * badges and keyset pagination, and a corrected/deleted row's event is
 * superseded rather than removed.
 */
describe("Health timeline e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE = "+919000000911";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";
  const TZ = "Asia/Kolkata";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, encounters, organizations,
        share_access_events, share_links, share_packages,
        prescription_documents, object_access_events, stored_objects,
        report_values, medical_reports, blood_pressure_readings, weight_readings,
        glucose_readings, checkup_records, dose_events, scheduled_doses, medication_schedules,
        medication_changes, medication_instructions, patient_medications,
        prescriptions, practitioners, patient_allergies, patient_conditions,
        consent_events, consents, caregiver_permissions, caregiver_relationships,
        sessions, user_devices, otp_attempts, patient_profiles, users CASCADE
    `);
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string, profileId?: string) => (req: request.Test) => {
    req.set("authorization", `Bearer ${token}`).set("x-requested-with", "medpass");
    if (profileId) req.set("x-profile-id", profileId);
    return req;
  };

  async function signIn(phone: string): Promise<string> {
    await prisma.otpAttempt.deleteMany({});
    await request(app.getHttpServer()).post("/v1/auth/otp/request").send({ phone }).expect(202);
    const verify = await request(app.getHttpServer())
      .post("/v1/auth/otp/verify")
      .send({ phone, code: CODE, device: { kind: "browser" } })
      .expect(201);
    return verify.body.token;
  }

  type Item = {
    id: string;
    kind: string;
    occurredAt: string;
    occurredAtLocal: string | null;
    entityType: string;
    entityId: string;
    summary: Record<string, unknown>;
    provenanceSource: string | null;
    verification: string | null;
    supersededAt: string | null;
  };

  const timeline = (query = "") =>
    auth(token, profileId)(request(app.getHttpServer()).get(`/v1/profiles/current/health-timeline${query}`)).expect(200);

  let token: string;
  let profileId: string;
  let stoppedMedicationId: string;
  let currentMedicationId: string;
  let prescriptionId: string;
  let reportId: string;
  let bpReadingId: string;
  let checkupId: string;
  let shareId: string;

  it("sets up a patient and writes one of everything", async () => {
    token = await signIn(PHONE);
    profileId = (
      await auth(token)(request(app.getHttpServer()).post("/v1/profiles"))
        .send({ displayName: "Timeline Patient", yearOfBirth: 1965, preferredLocale: "en" })
        .expect(201)
    ).body.id;

    // Medicine: add → change instruction → stop.
    const med = await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
      .send({ enteredName: "Metformin", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" } })
      .expect(201);
    stoppedMedicationId = med.body.id;
    const edited = await auth(token, profileId)(request(app.getHttpServer()).patch(`/v1/medications/${stoppedMedicationId}`))
      .send({ rowVersion: med.body.rowVersion, instruction: { doseQuantity: 2, doseUnit: "tablet", frequencyCode: "BD" } })
      .expect(200);
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/medications/${stoppedMedicationId}/status`))
      .send({ status: "stopped", rowVersion: edited.body.rowVersion, reason: "Doctor changed the plan" })
      .expect(201);
    // A second medicine stays current so the summary has an active count.
    currentMedicationId = (
      await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/medications"))
        .send({ enteredName: "Amlodipine", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
        .expect(201)
    ).body.id;

    prescriptionId = (
      await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/prescriptions"))
        .send({ practitionerName: "Dr. Sharma", prescribedAt: "2026-07-20" })
        .expect(201)
    ).body.id;

    reportId = (
      await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/reports"))
        .send({ kind: "blood_test", label: "HbA1c panel", facilityName: "City Lab", testedAt: "2026-07-22" })
        .expect(201)
    ).body.id;
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/reports/${reportId}/values`)).send({ analyte: "hba1c", enteredValue: "7.4" }).expect(201);
    await auth(token, profileId)(request(app.getHttpServer()).post(`/v1/reports/${reportId}/values`)).send({ analyte: "fasting_glucose", enteredValue: "132" }).expect(201);

    bpReadingId = (
      await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/blood-pressure-readings"))
        .send({ measuredAt: "2026-07-23T02:15:00.000Z", systolic: 128, diastolic: 82, pulseBpm: 74 })
        .expect(201)
    ).body.id;
    await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/glucose-readings"))
      .send({ measuredAt: "2026-07-23T01:00:00.000Z", context: "before_breakfast", valueMgDl: 118 })
      .expect(201);

    checkupId = (
      await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/checkup-records"))
        .send({ checkupDate: "2026-07-24", hba1cPercent: 7.4, weightKg: 71 })
        .expect(201)
    ).body.id;

    await stepUp(app.getHttpServer(), token); // ADR-V2-012
    shareId = (
      await auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/shares"))
        .send({ sections: {}, expiresInHours: 24, kind: "link" })
        .expect(201)
    ).body.id;
  });

  it("returns every write as an event, newest first, with kinds, local time and provenance", async () => {
    const res = await timeline();
    const items: Item[] = res.body.items;
    expect(res.body.nextCursor).toBeNull();

    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1]!.occurredAt >= items[i]!.occurredAt).toBe(true);
    }
    for (const item of items) {
      expect(item.supersededAt).toBeNull();
      expect(item.occurredAtLocal).toBe(localIso(new Date(item.occurredAt), TZ));
    }

    const byEntity = (entityType: string, entityId: string) => items.filter((i) => i.entityType === entityType && i.entityId === entityId);
    const medEvents = items.filter((i) => i.entityType === "medication_change" && i.summary.medicationId === stoppedMedicationId);
    expect(medEvents.map((e) => e.kind).sort()).toEqual(["medicine_changed", "medicine_started", "medicine_stopped"]);
    expect(medEvents.every((e) => e.summary.name === "Metformin")).toBe(true);
    expect(items.filter((i) => i.summary.medicationId === currentMedicationId).map((e) => e.kind)).toEqual(["medicine_started"]);

    const rx = byEntity("prescription", prescriptionId);
    expect(rx).toHaveLength(1);
    expect(rx[0]).toMatchObject({ kind: "prescription", occurredAtLocal: "2026-07-20T12:00:00", provenanceSource: "user_entered", verification: "patient_confirmed" });
    expect(rx[0]!.summary).toMatchObject({ practitionerName: "Dr. Sharma", dateSource: "prescribed" });

    const report = byEntity("medical_report", reportId);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ kind: "test_result", occurredAtLocal: "2026-07-22T12:00:00" });
    expect(report[0]!.summary).toMatchObject({ reportKind: "blood_test", label: "HbA1c panel", valueCount: 2 });

    const bp = byEntity("blood_pressure_reading", bpReadingId);
    expect(bp[0]).toMatchObject({ kind: "measurement", occurredAt: "2026-07-23T02:15:00.000Z", occurredAtLocal: "2026-07-23T07:45:00" });
    expect(bp[0]!.summary).toEqual({ concept: "blood_pressure", systolic: 128, diastolic: 82, pulse: 74, unit: "mmHg" });
    expect(items.filter((i) => i.entityType === "glucose_reading")[0]!.summary).toMatchObject({ concept: "blood_glucose", value: 118, unit: "mg/dL", context: "before_breakfast" });

    const checkup = byEntity("checkup_record", checkupId);
    expect(checkup[0]).toMatchObject({ kind: "doctor_visit", occurredAtLocal: "2026-07-24T12:00:00" });
    expect(checkup[0]!.summary).toMatchObject({ metrics: { hba1cPercent: true, weightKg: true } });

    const share = byEntity("share_link", shareId);
    expect(share[0]).toMatchObject({ kind: "share_created", provenanceSource: null, verification: null });

    // Every clinical row was stamped user_entered / patient_confirmed by the server.
    for (const item of items.filter((i) => i.entityType !== "share_link")) {
      expect(item).toMatchObject({ provenanceSource: "user_entered", verification: "patient_confirmed" });
    }
    expect(items).toHaveLength(10);
  });

  it("paginates with an opaque keyset cursor and no overlap", async () => {
    const all: Item[] = (await timeline()).body.items;
    const first = await timeline("?limit=3");
    expect(first.body.items).toHaveLength(3);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const seen: string[] = first.body.items.map((i: Item) => i.id);
    let cursor: string | null = first.body.nextCursor;
    while (cursor) {
      const page = await timeline(`?limit=3&cursor=${encodeURIComponent(cursor)}`);
      expect(page.body.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.body.items.map((i: Item) => i.id));
      cursor = page.body.nextCursor;
    }
    expect(seen).toEqual(all.map((i) => i.id));
    expect(new Set(seen).size).toBe(all.length);

    await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/health-timeline?cursor=not-a-cursor")).expect(400);
    await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/health-timeline?limit=500")).expect(400);
  });

  it("filters by kinds (comma-separated) and by date range", async () => {
    const filtered: Item[] = (await timeline("?kinds=measurement,prescription")).body.items;
    expect(filtered.length).toBe(3);
    expect(new Set(filtered.map((i) => i.kind))).toEqual(new Set(["measurement", "prescription"]));
    await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/health-timeline?kinds=nonsense")).expect(400);

    const ranged: Item[] = (await timeline("?from=2026-07-21T00:00:00.000Z&to=2026-07-23T23:59:59.000Z")).body.items;
    expect(ranged.map((i) => i.entityType).sort()).toEqual(["blood_pressure_reading", "glucose_reading", "medical_report"]);
  });

  it("hides a deleted row's event unless includeSuperseded is asked for", async () => {
    await auth(token, profileId)(request(app.getHttpServer()).delete(`/v1/blood-pressure-readings/${bpReadingId}`)).expect(204);

    const live: Item[] = (await timeline()).body.items;
    expect(live.find((i) => i.entityId === bpReadingId)).toBeUndefined();
    expect(live).toHaveLength(9);

    const withSuperseded: Item[] = (await timeline("?includeSuperseded=true")).body.items;
    const gone = withSuperseded.find((i) => i.entityId === bpReadingId);
    expect(gone).toBeDefined();
    expect(gone!.supersededAt).toEqual(expect.any(String));
    expect(withSuperseded).toHaveLength(10);
  });

  it("summary counts live events per kind and takes the headline numbers from the source tables", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/health-timeline/summary")).expect(200);
    expect(res.body).toMatchObject({
      counts: {
        medicine_started: 2,
        medicine_changed: 1,
        medicine_stopped: 1,
        prescription: 1,
        test_result: 1,
        measurement: 1, // BP reading deleted → superseded → not counted
        doctor_visit: 1,
        share_created: 1,
      },
      medicines: { active: 1 },
      prescriptions: 1,
      tests: 1,
      measurements: 1,
      documents: 0,
    });
    const live: Item[] = (await timeline()).body.items;
    expect(res.body.lastEventAt).toBe(live[0]!.occurredAt);
  });

  it("leaves the dose timeline untouched", async () => {
    const res = await auth(token, profileId)(request(app.getHttpServer()).get("/v1/profiles/current/timeline")).expect(200);
    expect(res.body).toHaveProperty("date");
  });
});
