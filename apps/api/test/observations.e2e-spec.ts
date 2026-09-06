import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { stepUp } from "./helpers/step-up";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";

/**
 * Observations (docs_v2/04 §5, docs_v2/05 §7, ADR-V2-011) — the generic
 * measurement model that succeeds the V1 glucose / blood-pressure / weight
 * diaries. What these cover, in order of how much they would hurt to get
 * wrong:
 *
 *  - the canonical unit per concept is enforced and the entered unit is
 *    converted, so 5.5 mmol/L never lands on an mg/dL axis as "5.5";
 *  - the plausibility range is plausibility only: a typo is refused, a
 *    frightening-but-real reading is stored without comment (hazard H-25);
 *  - a blood pressure keeps its two numbers, and the pulse the same cuff
 *    reported becomes its own heart_rate observation;
 *  - device sync dedupes, so a meter handed over twice leaves one diary;
 *  - the V1 diaries keep their shapes, now mirror here, and still emit
 *    exactly one timeline event per reading.
 */
describe("Observations e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PHONE_A = "+919000000841";
  const PHONE_B = "+919000000842";
  const PHONE_C = "+919000000843";
  const CODE = process.env.OTP_DEV_FIXED_CODE ?? "000000";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events,
        observations, measurement_devices, diagnostic_results, diagnostic_reports,
        glucose_readings, blood_pressure_readings, weight_readings, checkup_records,
        report_values, medical_reports, practitioners,
        patient_allergies, patient_conditions, consent_events, consents,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
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

  const post = (token: string, profileId: string, body: Record<string, unknown>) =>
    auth(token, profileId)(request(app.getHttpServer()).post("/v1/profiles/current/observations")).send(body);

  let tokenA: string;
  let tokenB: string;
  let tokenC: string;
  let profileA: string;
  let profileC: string;
  let glucoseObservationId: string;
  let deviceId: string;

  it("sets up a patient, a view_medications-only caregiver, and an unrelated patient", async () => {
    tokenA = await signIn(PHONE_A);
    const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Observations Test", yearOfBirth: 1966, preferredLocale: "en" })
      .expect(201);
    profileA = profile.body.id;

    tokenB = await signIn(PHONE_B);
    await stepUp(app.getHttpServer(), tokenA); // ADR-V2-012
    const invite = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/caregivers"))
      .send({ phone: PHONE_B, scopes: ["view_medications"], relationship: "child" })
      .expect(201);
    await auth(tokenB)(request(app.getHttpServer()).post("/v1/caregivers/accept")).send({ invitationId: invite.body.id }).expect(201);

    tokenC = await signIn(PHONE_C);
    const other = await auth(tokenC)(request(app.getHttpServer()).post("/v1/profiles"))
      .send({ displayName: "Someone Else", yearOfBirth: 1988, preferredLocale: "en" })
      .expect(201);
    profileC = other.body.id;
  });

  // ───────────────────────── CRUD + units ─────────────────────────

  it("records a measurement, stamping the LOINC code, canonical unit and local time", async () => {
    const created = await post(tokenA, profileA, {
      concept: "blood_glucose",
      valueNumeric: 132,
      context: "after_lunch",
      method: "fingerstick",
      measuredAt: "2026-08-10T09:15:00.000Z",
      notes: "heavy lunch",
    }).expect(201);
    glucoseObservationId = created.body.id;
    expect(created.body).toMatchObject({
      concept: "blood_glucose",
      label: "Blood glucose",
      conceptCode: "2339-0",
      conceptSystem: "http://loinc.org",
      valueNumeric: "132",
      valueNumeric2: null,
      unit: "mg/dL",
      enteredUnit: null,
      context: "after_lunch",
      method: "fingerstick",
      notes: "heavy lunch",
      interpretation: null,
      provenanceSource: "user_entered",
    });
    // 09:15 UTC is 14:45 in Kolkata — the patient's own clock, resolved once
    // at write time (docs/16, hazard H-28).
    expect(created.body.measuredAtLocal).toBe("2026-08-10T14:45:00");

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/observations?concept=blood_glucose")).expect(200);
    expect(list.body.items.map((o: { id: string }) => o.id)).toContain(glucoseObservationId);
  });

  it("converts the entered unit to the concept's canonical unit", async () => {
    const created = await post(tokenA, profileA, {
      concept: "blood_glucose",
      valueNumeric: 5.5,
      enteredUnit: "mmol/L",
      measuredAt: "2026-08-11T01:00:00.000Z",
    }).expect(201);
    // 5.5 mmol/L × 18.0182 = 99.100 mg/dL, and the unit the patient chose
    // survives on the row so the UI can still say "you entered 5.5 mmol/L".
    expect(created.body).toMatchObject({ unit: "mg/dL", enteredUnit: "mmol/L" });
    expect(Number(created.body.valueNumeric)).toBeCloseTo(99.1, 2);
  });

  it("converts °F to °C rather than storing a number in the wrong scale", async () => {
    const created = await post(tokenA, profileA, {
      concept: "body_temperature",
      valueNumeric: 100.4,
      enteredUnit: "°F",
      measuredAt: "2026-08-11T02:00:00.000Z",
    }).expect(201);
    expect(created.body.unit).toBe("Cel");
    expect(Number(created.body.valueNumeric)).toBeCloseTo(38, 2);
  });

  it("refuses a unit that does not belong to the concept", async () => {
    const res = await post(tokenA, profileA, {
      concept: "body_weight",
      valueNumeric: 71,
      enteredUnit: "mmHg",
      measuredAt: "2026-08-11T02:30:00.000Z",
    }).expect(400);
    expect(res.body.code).toBe("validation_failed");
  });

  // ───────────────────────── plausibility, not thresholds ─────────────────────────

  it("refuses a value outside the concept's plausibility range", async () => {
    const res = await post(tokenA, profileA, {
      concept: "spo2",
      valueNumeric: 140,
      measuredAt: "2026-08-11T03:00:00.000Z",
    }).expect(400);
    expect(res.body.code).toBe("observation_out_of_range");
  });

  it("stores a frightening but plausible reading without comment — the range is not a threshold", async () => {
    // SpO2 of 80 is alarming and entirely possible. The app records it and
    // says nothing about what it means (hazard H-25).
    const created = await post(tokenA, profileA, {
      concept: "spo2",
      valueNumeric: 80,
      measuredAt: "2026-08-11T03:05:00.000Z",
    }).expect(201);
    expect(created.body).toMatchObject({ valueNumeric: "80", unit: "%", interpretation: null });
  });

  it("checks systolic and diastolic against their own bounds, not one shared one", async () => {
    // 250/40 is a plausible systolic with an implausible-typo diastolic…
    await post(tokenA, profileA, { concept: "blood_pressure", valueNumeric: 250, valueNumeric2: 5, measuredAt: "2026-08-11T03:10:00.000Z" }).expect(400);
    // …and 250/95 is a real, dangerous reading that must be storable.
    await post(tokenA, profileA, { concept: "blood_pressure", valueNumeric: 250, valueNumeric2: 95, measuredAt: "2026-08-11T03:11:00.000Z" }).expect(201);
  });

  it("refuses an interpretation from a patient — this app never decides normal/high/low", async () => {
    const res = await post(tokenA, profileA, {
      concept: "spo2",
      valueNumeric: 96,
      interpretation: "normal",
      measuredAt: "2026-08-11T03:20:00.000Z",
    }).expect(400);
    expect(res.body.code).toBe("interpretation_not_client_settable");
  });

  it("refuses client-set provenance (ADR-V2-002)", async () => {
    const res = await post(tokenA, profileA, {
      concept: "spo2",
      valueNumeric: 97,
      measuredAt: "2026-08-11T03:25:00.000Z",
      provenanceSource: "device_recorded",
    }).expect(400);
    expect(res.body.code).toBe("provenance_not_client_settable");
  });

  // ───────────────────────── blood pressure and its pulse ─────────────────────────

  it("keeps a blood pressure's two numbers and files the pulse as its own heart_rate row", async () => {
    const created = await post(tokenA, profileA, {
      concept: "blood_pressure",
      valueNumeric: 142,
      valueNumeric2: 88,
      pulseBpm: 76,
      bodySite: "left arm",
      measuredAt: "2026-08-12T02:00:00.000Z",
    }).expect(201);
    expect(created.body).toMatchObject({ concept: "blood_pressure", valueNumeric: "142", valueNumeric2: "88", unit: "mm[Hg]", bodySite: "left arm" });
    // The pulse is not part of the pressure: two measurements, two rows.
    expect(created.body).not.toHaveProperty("pulseBpm");

    const pulse = await prisma.observation.findFirst({
      where: { patientProfileId: profileA, concept: "heart_rate", measuredAt: new Date("2026-08-12T02:00:00.000Z") },
    });
    expect(pulse).not.toBeNull();
    expect(pulse!.valueNumeric!.toString()).toBe("76");
    expect(pulse!.unit).toBe("/min");
    expect(pulse!.conceptCode).toBe("8867-4");
  });

  it("refuses a second number, or a pulse, on a concept that has neither", async () => {
    await post(tokenA, profileA, { concept: "body_weight", valueNumeric: 71, valueNumeric2: 12, measuredAt: "2026-08-12T02:05:00.000Z" }).expect(400);
    await post(tokenA, profileA, { concept: "body_weight", valueNumeric: 71, pulseBpm: 70, measuredAt: "2026-08-12T02:06:00.000Z" }).expect(400);
    await post(tokenA, profileA, { concept: "blood_pressure", valueNumeric: 130, measuredAt: "2026-08-12T02:07:00.000Z" }).expect(400);
  });

  // ───────────────────────── measurement devices ─────────────────────────

  it("registers a measurement device and lists it", async () => {
    const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/measurement-devices"))
      .send({ kind: "glucometer", platform: "bluetooth", manufacturer: "Accu-Chek", model: "Instant", label: "Kitchen meter", serialDigest: "sha256:abc" })
      .expect(201);
    deviceId = created.body.id;
    expect(created.body).toMatchObject({ kind: "glucometer", platform: "bluetooth", manufacturer: "Accu-Chek", label: "Kitchen meter", status: "active" });
    // The serial digest is a recognition token, never returned or displayed.
    expect(created.body).not.toHaveProperty("serialDigest");

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/measurement-devices")).expect(200);
    expect(list.body.items.find((d: { id: string }) => d.id === deviceId)).toMatchObject({ observationCount: 0 });
  });

  it("renames a device and retires it without losing its readings", async () => {
    const renamed = await auth(tokenA, profileA)(request(app.getHttpServer()).patch(`/v1/measurement-devices/${deviceId}`))
      .send({ label: "Bedroom meter" })
      .expect(200);
    expect(renamed.body.label).toBe("Bedroom meter");

    const spare = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/measurement-devices"))
      .send({ kind: "smart_scale", platform: "health_connect" })
      .expect(201);
    await post(tokenA, profileA, { concept: "body_weight", valueNumeric: 70.2, deviceId: spare.body.id, measuredAt: "2026-08-12T03:00:00.000Z" }).expect(201);
    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/measurement-devices/${spare.body.id}`)).expect(204);

    const list = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/measurement-devices")).expect(200);
    expect(list.body.items.map((d: { id: string }) => d.id)).not.toContain(spare.body.id);
    // The reading is the patient's, not the meter's: it survives the meter.
    const kept = await prisma.observation.findFirst({ where: { deviceId: spare.body.id, deletedAt: null } });
    expect(kept).not.toBeNull();
  });

  it("refuses a device belonging to someone else", async () => {
    const theirs = await auth(tokenC, profileC)(request(app.getHttpServer()).post("/v1/profiles/current/measurement-devices"))
      .send({ kind: "bp_monitor" })
      .expect(201);
    await post(tokenA, profileA, { concept: "spo2", valueNumeric: 98, deviceId: theirs.body.id, measuredAt: "2026-08-12T03:10:00.000Z" }).expect(404);
  });

  // ───────────────────────── device sync ─────────────────────────

  it("dedupes a batch on (concept, measuredAt, deviceId), inside the batch and against stored rows", async () => {
    const at = (iso: string) => `2026-08-13T${iso}:00.000Z`;
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/observations/batch"))
      .send({
        deviceId,
        items: [
          { concept: "blood_glucose", valueNumeric: 110, measuredAt: at("01:00") },
          { concept: "blood_glucose", valueNumeric: 145, measuredAt: at("07:00") },
          // The same instant, the same meter, sent twice in one upload.
          { concept: "blood_glucose", valueNumeric: 110, measuredAt: at("01:00") },
        ],
      })
      .expect(201);
    expect(res.body).toMatchObject({ submitted: 3, created: 2, duplicates: 1 });
    expect(res.body.items).toHaveLength(2);

    // The upload retried on a flaky train: everything is already there.
    const retry = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/observations/batch"))
      .send({
        deviceId,
        items: [
          { concept: "blood_glucose", valueNumeric: 110, measuredAt: at("01:00") },
          { concept: "blood_glucose", valueNumeric: 145, measuredAt: at("07:00") },
        ],
      })
      .expect(201);
    expect(retry.body).toMatchObject({ submitted: 2, created: 0, duplicates: 2 });

    const stored = await prisma.observation.count({
      where: { patientProfileId: profileA, deviceId, measuredAt: { gte: new Date(at("00:00")), lt: new Date("2026-08-14T00:00:00.000Z") } },
    });
    expect(stored).toBe(2);
  });

  it("treats the same instant from a different meter as a different reading", async () => {
    const second = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/measurement-devices"))
      .send({ kind: "cgm", platform: "vendor_api" })
      .expect(201);
    const res = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/observations/batch"))
      .send({ deviceId: second.body.id, items: [{ concept: "blood_glucose", valueNumeric: 112, measuredAt: "2026-08-13T01:00:00.000Z" }] })
      .expect(201);
    expect(res.body).toMatchObject({ created: 1, duplicates: 0 });
  });

  it("stamps the device's last sync time", async () => {
    const device = await prisma.measurementDevice.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device.lastSyncAt).not.toBeNull();
  });

  it("refuses the whole batch when one item is implausible — a partial sync would be a silent gap", async () => {
    await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/observations/batch"))
      .send({
        deviceId,
        items: [
          { concept: "blood_glucose", valueNumeric: 120, measuredAt: "2026-08-14T01:00:00.000Z" },
          { concept: "blood_glucose", valueNumeric: 99999, measuredAt: "2026-08-14T02:00:00.000Z" },
        ],
      })
      .expect(400);
    const stored = await prisma.observation.count({ where: { patientProfileId: profileA, measuredAt: new Date("2026-08-14T01:00:00.000Z") } });
    expect(stored).toBe(0);
  });

  // ───────────────────────── trends ─────────────────────────

  describe("trends", () => {
    let trendProfile: string;

    beforeAll(async () => {
      // A second profile of its own, so the trend windows see only the
      // readings this block seeds and nothing from the tests above.
      const profile = await auth(tokenA)(request(app.getHttpServer()).post("/v1/profiles/dependents"))
        .send({ displayName: "Trend Fixture", yearOfBirth: 1955, relationship: "parent", preferredLocale: "en" })
        .expect(201);
      trendProfile = profile.body.id;

      // Nine readings across three consecutive local days, morning and
      // evening, all inside the 7-day window.
      const now = Date.now();
      const items: Array<Record<string, unknown>> = [];
      for (let dayAgo = 1; dayAgo <= 3; dayAgo += 1) {
        const base = new Date(now - dayAgo * 86_400_000);
        const day = base.toISOString().slice(0, 10);
        // 03:00 UTC = 08:30 Kolkata (morning); 14:00 UTC = 19:30 (evening).
        items.push({ concept: "blood_glucose", valueNumeric: 100 + dayAgo, measuredAt: `${day}T03:00:00.000Z` });
        items.push({ concept: "blood_glucose", valueNumeric: 150 + dayAgo, measuredAt: `${day}T14:00:00.000Z` });
      }
      await auth(tokenA, trendProfile)(request(app.getHttpServer()).post("/v1/profiles/current/observations/batch"))
        .send({ items })
        .expect(201);
    }, 30000);

    it("buckets by the patient's own calendar day and reports descriptive statistics only", async () => {
      const res = await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_glucose?window=7d&bucket=day")).expect(200);
      expect(res.body).toMatchObject({ concept: "blood_glucose", unit: "mg/dL", window: "7d", bucket: "day", timezone: "Asia/Kolkata" });
      expect(res.body.points).toHaveLength(3);
      for (const point of res.body.points) {
        expect(point.count).toBe(2);
        expect(point.max).toBeGreaterThan(point.min);
        expect(point.bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // Descriptive only: nothing on the response says whether any of this
      // is good or bad.
      expect(JSON.stringify(res.body)).not.toContain("interpretation");
    });

    it("carries a rolling average across the buckets", async () => {
      const res = await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_glucose?window=7d&bucket=day")).expect(200);
      const [first, , last] = res.body.points;
      expect(first.rollingAverage).toBeCloseTo(first.average, 3);
      // The last bucket's rolling average is the mean of everything so far.
      expect(last.rollingAverage).toBeCloseTo(res.body.summary.average, 3);
    });

    it("splits morning from evening on the local clock", async () => {
      const res = await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_glucose?window=7d&bucket=day")).expect(200);
      expect(res.body.summary.morning.count).toBe(3);
      expect(res.body.summary.evening.count).toBe(3);
      // Mornings are the fasting-ish readings here; evenings are higher.
      expect(res.body.summary.evening.average).toBeGreaterThan(res.body.summary.morning.average);
      for (const point of res.body.points) {
        expect(point.morning.count).toBe(1);
        expect(point.evening.count).toBe(1);
      }
    });

    it("collapses the same readings into one bucket at week and month granularity", async () => {
      const week = await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_glucose?window=30d&bucket=week")).expect(200);
      const month = await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_glucose?window=90d&bucket=month")).expect(200);
      expect(week.body.points.length).toBeLessThanOrEqual(2);
      expect(month.body.points.length).toBeLessThanOrEqual(2);
      expect(month.body.points[0].bucket).toMatch(/^\d{4}-\d{2}$/);
      // Every window sees the same six readings; only the grouping changes.
      expect(week.body.summary.count).toBe(6);
      expect(month.body.summary.count).toBe(6);
    });

    it("reports a blood pressure's two numbers separately in the trend", async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      await auth(tokenA, trendProfile)(request(app.getHttpServer()).post("/v1/profiles/current/observations"))
        .send({ concept: "blood_pressure", valueNumeric: 138, valueNumeric2: 86, measuredAt: `${yesterday}T04:00:00.000Z` })
        .expect(201);
      const res = await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_pressure?window=7d")).expect(200);
      expect(res.body.summary).toMatchObject({ count: 1, average: 138, average2: 86, min: 138, max: 138 });
    });

    it("returns an empty, honest trend rather than an error when nothing was measured", async () => {
      const res = await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/peak_flow?window=30d")).expect(200);
      expect(res.body.points).toEqual([]);
      expect(res.body.summary).toMatchObject({ count: 0, average: null, min: null, max: null });
    });

    it("rejects an unknown window, bucket or concept rather than guessing one", async () => {
      await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_glucose?window=1y")).expect(400);
      await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_glucose?bucket=hour")).expect(400);
      await auth(tokenA, trendProfile)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/mood")).expect(400);
    });
  });

  // ───────────────────────── access control ─────────────────────────

  it("hides another patient's measurement behind a 404 rather than a 403 (IDOR)", async () => {
    await auth(tokenC, profileC)(request(app.getHttpServer()).get(`/v1/observations/${glucoseObservationId}`)).expect(404);
    await auth(tokenC, profileC)(request(app.getHttpServer()).delete(`/v1/observations/${glucoseObservationId}`)).expect(404);
    await auth(tokenC, profileC)(request(app.getHttpServer()).patch(`/v1/measurement-devices/${deviceId}`)).send({ label: "mine now" }).expect(404);
    // A foreign profile header is refused before any row is touched.
    await auth(tokenC, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/observations")).expect(403);
  });

  it("lets a view_medications-only caregiver read the diary but not write to it", async () => {
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/observations")).expect(200);
    await auth(tokenB, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/trends/observations/blood_glucose")).expect(200);
    await post(tokenB, profileA, { concept: "spo2", valueNumeric: 97, measuredAt: "2026-08-15T01:00:00.000Z" }).expect(403);
    await auth(tokenB, profileA)(request(app.getHttpServer()).delete(`/v1/observations/${glucoseObservationId}`)).expect(403);
  });

  // ───────────────────────── timeline ─────────────────────────

  it("emits one measurement event per observation and supersedes it on delete", async () => {
    const events = await prisma.healthEvent.findMany({ where: { entityType: "observation", entityId: glucoseObservationId } });
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("measurement");
    const summary = events[0]!.summary as Record<string, unknown>;
    expect(summary).toMatchObject({ concept: "blood_glucose", unit: "mg/dL", context: "after_lunch" });

    await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/observations/${glucoseObservationId}`)).expect(204);
    await auth(tokenA, profileA)(request(app.getHttpServer()).get(`/v1/observations/${glucoseObservationId}`)).expect(404);
    const after = await prisma.healthEvent.findMany({ where: { entityType: "observation", entityId: glucoseObservationId } });
    expect(after[0]!.supersededAt).not.toBeNull();
  });

  // ───────────────────────── V1 dual-write parity ─────────────────────────

  describe("V1 diaries keep working and now mirror into the Observation model", () => {
    let v1GlucoseId: string;
    let v1BpId: string;
    let v1WeightId: string;

    it("mirrors a V1 glucose reading, keeping the V1 response shape", async () => {
      const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/glucose-readings"))
        .send({ measuredAt: "2026-08-20T01:30:00.000Z", context: "before_breakfast", valueMgDl: 118, note: "slept badly" })
        .expect(201);
      v1GlucoseId = created.body.id;
      // The V1 contract is byte-for-byte what it was.
      expect(created.body).toMatchObject({ context: "before_breakfast", valueMgDl: 118, note: "slept badly" });
      expect(created.body).not.toHaveProperty("observationId");

      const mirror = await prisma.observation.findUniqueOrThrow({
        where: { legacyEntityType_legacyId: { legacyEntityType: "glucose_reading", legacyId: v1GlucoseId } },
      });
      expect(mirror).toMatchObject({ concept: "blood_glucose", unit: "mg/dL", context: "before_breakfast", notes: "slept badly", conceptCode: "2339-0" });
      expect(mirror.valueNumeric!.toString()).toBe("118");
      expect(mirror.measuredAtLocal).toBe("2026-08-20T07:00:00");
    });

    it("mirrors a V1 blood pressure as a pressure plus its own pulse row", async () => {
      const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/blood-pressure-readings"))
        .send({ measuredAt: "2026-08-20T02:00:00.000Z", systolic: 136, diastolic: 84, pulseBpm: 71 })
        .expect(201);
      v1BpId = created.body.id;
      expect(created.body).toMatchObject({ systolic: 136, diastolic: 84, pulseBpm: 71 });

      const pressure = await prisma.observation.findUniqueOrThrow({
        where: { legacyEntityType_legacyId: { legacyEntityType: "blood_pressure_reading", legacyId: v1BpId } },
      });
      expect(pressure.valueNumeric!.toString()).toBe("136");
      expect(pressure.valueNumeric2!.toString()).toBe("84");
      expect(pressure.unit).toBe("mm[Hg]");

      const pulse = await prisma.observation.findUniqueOrThrow({
        where: { legacyEntityType_legacyId: { legacyEntityType: "blood_pressure_reading_pulse", legacyId: v1BpId } },
      });
      expect(pulse).toMatchObject({ concept: "heart_rate", unit: "/min" });
      expect(pulse.valueNumeric!.toString()).toBe("71");
    });

    it("mirrors a V1 weight reading", async () => {
      const created = await auth(tokenA, profileA)(request(app.getHttpServer()).post("/v1/profiles/current/weight-readings"))
        .send({ measuredAt: "2026-08-20T02:30:00.000Z", weightKg: 69.8 })
        .expect(201);
      v1WeightId = created.body.id;
      const mirror = await prisma.observation.findUniqueOrThrow({
        where: { legacyEntityType_legacyId: { legacyEntityType: "weight_reading", legacyId: v1WeightId } },
      });
      expect(mirror).toMatchObject({ concept: "body_weight", unit: "kg" });
      expect(Number(mirror.valueNumeric!.toString())).toBeCloseTo(69.8, 3);
    });

    it("emits the timeline event exactly once, not once per model", async () => {
      for (const [legacyType, legacyId] of [
        ["glucose_reading", v1GlucoseId],
        ["blood_pressure_reading", v1BpId],
        ["weight_reading", v1WeightId],
      ] as const) {
        const v1Events = await prisma.healthEvent.findMany({ where: { entityType: legacyType, entityId: legacyId } });
        expect(v1Events).toHaveLength(1);
        const mirror = await prisma.observation.findUniqueOrThrow({
          where: { legacyEntityType_legacyId: { legacyEntityType: legacyType, legacyId } },
        });
        const mirrorEvents = await prisma.healthEvent.findMany({ where: { entityType: "observation", entityId: mirror.id } });
        expect(mirrorEvents).toHaveLength(0);
      }
    });

    it("shows V1-entered readings on the V2 trend, so one history spans both models", async () => {
      const rows = await prisma.observation.findMany({ where: { patientProfileId: profileA, legacyEntityType: { not: null }, deletedAt: null } });
      expect(rows.length).toBeGreaterThanOrEqual(4);
      const listed = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/observations?concept=heart_rate")).expect(200);
      expect(listed.body.items.map((o: { valueNumeric: string }) => o.valueNumeric)).toContain("71");
    });

    it("soft-deletes both mirrors when the V1 blood pressure is deleted", async () => {
      await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/blood-pressure-readings/${v1BpId}`)).expect(204);
      for (const legacyType of ["blood_pressure_reading", "blood_pressure_reading_pulse"] as const) {
        const mirror = await prisma.observation.findUniqueOrThrow({
          where: { legacyEntityType_legacyId: { legacyEntityType: legacyType, legacyId: v1BpId } },
        });
        expect(mirror.deletedAt).not.toBeNull();
      }
    });

    it("soft-deletes the mirror when a V1 glucose or weight reading is deleted", async () => {
      await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/glucose-readings/${v1GlucoseId}`)).expect(204);
      await auth(tokenA, profileA)(request(app.getHttpServer()).delete(`/v1/weight-readings/${v1WeightId}`)).expect(204);
      for (const [legacyType, legacyId] of [
        ["glucose_reading", v1GlucoseId],
        ["weight_reading", v1WeightId],
      ] as const) {
        const mirror = await prisma.observation.findUniqueOrThrow({
          where: { legacyEntityType_legacyId: { legacyEntityType: legacyType, legacyId } },
        });
        expect(mirror.deletedAt).not.toBeNull();
      }
      const listed = await auth(tokenA, profileA)(request(app.getHttpServer()).get("/v1/profiles/current/observations?concept=body_weight")).expect(200);
      expect(listed.body.items.map((o: { legacyId: string | null }) => o.legacyId)).not.toContain(v1WeightId);
    });
  });
});
