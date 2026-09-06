import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { phoneDigest } from "../src/common/crypto";
import { authHeaders, patientSignIn } from "./helpers/provider";

/**
 * V2 Phase 10 — the treatment journey (docs_v2/06 P10).
 *
 * The four things this spec exists to hold down, all of them exit-gate M10
 * properties rather than incidental behaviour:
 *
 * 1. Every derived edge is a *suggestion*. Nothing on the condition hub
 *    treats an inferred link as a fact until the patient says so.
 * 2. Confirming records who confirmed it.
 * 3. Another patient's edges, conditions and medicines are unreachable — a
 *    404, never a 403 that would confirm the id exists.
 * 4. The before/after payload carries numbers and window bounds and nothing
 *    else: no difference, no percentage, no verdict, nothing implying that
 *    the medicine caused the change.
 */
describe("Treatment journey e2e", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const server = () => app.getHttpServer();

  const OWNER_PHONE = "+919000000941";
  const OTHER_PHONE = "+919000000942";
  const VIEWER_PHONE = "+919000000943";

  let ownerToken: string;
  let otherToken: string;
  let viewerToken: string;
  let ownerUserId: string;
  let profileId: string;
  let otherProfileId: string;
  let conditionId: string;
  let medicationId: string;
  let practitionerId: string;

  /** The medicine's start date; every seeded reading is placed relative to it. */
  const START = "2026-03-01";
  const owner = () => authHeaders(ownerToken, profileId);

  async function seedReport(testedAt: string, hba1c: string) {
    const report = await owner()(request(server()).post("/v1/profiles/current/diagnostic-reports"))
      .send({ kind: "laboratory", category: "biochemistry", title: `Diabetes review ${testedAt}`, testedAt })
      .expect(201);
    await owner()(request(server()).post(`/v1/diagnostic-reports/${report.body.id}/results`))
      .send({ analyteKey: "hba1c", enteredValueText: hba1c })
      .expect(201);
  }

  async function seedGlucose(measuredAt: string, value: number) {
    await owner()(request(server()).post("/v1/profiles/current/observations"))
      .send({ concept: "blood_glucose", valueNumeric: value, measuredAt })
      .expect(201);
  }

  async function relationships(status?: string) {
    const res = await owner()(
      request(server()).get(`/v1/profiles/current/clinical-relationships${status ? `?status=${status}` : ""}`),
    ).expect(200);
    return res.body.items as Array<Record<string, never> & { id: string; kind: string; status: string; origin: string; basis: string; from: { id: string | null; key: string | null }; to: { id: string | null } }>;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.use(cookieParser());
    app.setGlobalPrefix("v1", { exclude: ["healthz", "readyz"] });
    await app.init();
    prisma = moduleRef.get(PrismaService);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE audit_events, rate_limit_buckets, health_events, clinical_relationships,
        observations, measurement_devices, diagnostic_results, diagnostic_reports,
        medication_changes, medication_instructions, patient_medications, prescriptions,
        practitioners, patient_conditions, patient_allergies,
        caregiver_permissions, caregiver_relationships, sessions,
        user_devices, otp_attempts, patient_profiles, users CASCADE
    `);

    ownerToken = await patientSignIn(server(), OWNER_PHONE);
    otherToken = await patientSignIn(server(), OTHER_PHONE);
    viewerToken = await patientSignIn(server(), VIEWER_PHONE);

    const profile = await authHeaders(ownerToken)(request(server()).post("/v1/profiles"))
      .send({ displayName: "Journey Patient", yearOfBirth: 1968, preferredLocale: "en" })
      .expect(201);
    profileId = profile.body.id;
    ownerUserId = (await prisma.patientProfile.findUniqueOrThrow({ where: { id: profileId } })).ownerUserId;

    const otherProfile = await authHeaders(otherToken)(request(server()).post("/v1/profiles"))
      .send({ displayName: "Someone Else", yearOfBirth: 1980, preferredLocale: "en" })
      .expect(201);
    otherProfileId = otherProfile.body.id;

    // A caregiver who may see the profile and its medicines, but not tests
    // or measurements — the split from docs_v2/04 §2.2.
    const viewerUser = await prisma.session.findFirstOrThrow({
      where: { user: { phoneDigest: phoneDigest(VIEWER_PHONE) } },
      select: { userId: true },
    });
    await prisma.caregiverRelationship.create({
      data: {
        patientProfileId: profileId,
        caregiverUserId: viewerUser.userId,
        invitedPhoneDigest: `d-${randomUUID()}`,
        relationship: "child",
        status: "active",
        acceptedAt: new Date(),
        permissions: { create: [{ scope: "view_medications", grantedByUserId: ownerUserId }] },
      },
    });

    const condition = await owner()(request(server()).post("/v1/profiles/current/conditions"))
      .send({ label: "Type 2 diabetes mellitus", clinicalStatus: "active", onsetDate: "2024-06-01" })
      .expect(201);
    conditionId = condition.body.id;

    const practitioner = await owner()(request(server()).post("/v1/profiles/current/practitioners"))
      .send({ displayName: "Dr. Anitha Rao", speciality: "Endocrinology" })
      .expect(201);
    practitionerId = practitioner.body.id;

    const medication = await owner()(request(server()).post("/v1/profiles/current/medications"))
      .send({
        enteredName: "Metformin 500mg",
        source: "manual",
        startDate: START,
        instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "BD" },
      })
      .expect(201);
    medicationId = medication.body.id;

    // The two links the inference reads: "why am I taking it" and "who prescribed it".
    await owner()(request(server()).patch(`/v1/medications/${medicationId}`))
      .send({ rowVersion: medication.body.rowVersion, reasonConditionId: conditionId, prescribingPractitionerId: practitionerId })
      .expect(200);

    await seedReport("2026-02-20", "9.1"); // baseline window (−30…0)
    await seedReport("2026-03-25", "8.2"); // day-30 window (+15…+45)
    await seedReport("2026-05-30", "7.4"); // day-90 window (+75…+105)
    await seedGlucose("2026-02-20T06:00:00.000Z", 186);
    await seedGlucose("2026-03-25T06:00:00.000Z", 154);
    await seedGlucose("2026-05-30T06:00:00.000Z", 132);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // ───────────────────────── inference ─────────────────────────

  it("derives edges from links the record already holds, and every one arrives as a suggestion", async () => {
    const items = await relationships();
    expect(items.length).toBeGreaterThan(0);
    for (const edge of items) {
      expect(edge.status).toBe("suggested");
      expect(edge.origin).toBe("inferred");
    }

    const byKind = (kind: string) => items.filter((e) => e.kind === kind);
    expect(byKind("medicine_for_condition")[0]).toMatchObject({ basis: "medicine_reason_condition", from: { id: medicationId }, to: { id: conditionId } });
    expect(byKind("provider_for_medicine")[0]).toMatchObject({ from: { id: practitionerId }, to: { id: medicationId } });
    expect(byKind("provider_for_condition")[0]).toMatchObject({ from: { id: practitionerId }, to: { id: conditionId } });
    // The analyte and the concept the patient actually has data for.
    expect(byKind("result_tracks_condition").map((e) => e.from.key)).toContain("hba1c");
    expect(byKind("measurement_tracks_condition").map((e) => e.from.key)).toContain("blood_glucose");
  });

  it("never suggests a test the patient has no results for", async () => {
    const items = await relationships();
    const analyteKeys = items.filter((e) => e.kind === "result_tracks_condition").map((e) => e.from.key);
    // "Usually monitored with" also lists fasting and post-prandial glucose
    // for diabetes; neither has a result on file, so neither is asked about.
    expect(analyteKeys).not.toContain("fasting_glucose");
    expect(analyteKeys).not.toContain("post_prandial_glucose");
  });

  it("is idempotent — re-reading the list does not duplicate a derived edge", async () => {
    const first = await relationships();
    const second = await relationships();
    expect(second.map((e) => e.id).sort()).toEqual(first.map((e) => e.id).sort());
  });

  // ───────────────────────── suggestions are not facts ─────────────────────────

  it("shows nothing as tracked or as a treating doctor while the link is only suggested", async () => {
    const hub = await owner()(request(server()).get(`/v1/profiles/current/conditions/${conditionId}/journey`)).expect(200);
    expect(hub.body.condition).toMatchObject({ id: conditionId, label: "Type 2 diabetes mellitus" });
    // The suggested analyte/concept/doctor edges exist, but the hub does not
    // present them as facts about this condition.
    expect(hub.body.results).toEqual([]);
    expect(hub.body.measurements).toEqual([]);
    expect(hub.body.doctors).toEqual([]);
    expect(hub.body.suggestions.length).toBeGreaterThan(0);
    for (const s of hub.body.suggestions) expect(s.status).toBe("suggested");
    // The medicine's own record names this condition, so the hub states that
    // as the recorded fact it is — and does not re-ask it as a question.
    expect(hub.body.medicines).toEqual([expect.objectContaining({ id: medicationId, linkSource: "medicine_record" })]);
    expect(hub.body.suggestions.some((s: { kind: string }) => s.kind === "medicine_for_condition")).toBe(false);
  });

  it("records who confirmed a suggestion, and raises the row's verification", async () => {
    const items = await relationships("suggested");
    const analyteEdge = items.find((e) => e.kind === "result_tracks_condition" && e.from.key === "hba1c")!;
    const before = new Date();
    const res = await owner()(request(server()).post(`/v1/clinical-relationships/${analyteEdge.id}/confirm`)).expect(201);

    expect(res.body).toMatchObject({
      id: analyteEdge.id,
      status: "confirmed",
      origin: "inferred",
      confirmedByUserId: ownerUserId,
      verification: "patient_confirmed",
      // How it was found stays visible after the answer.
      provenanceSource: "system_derived",
      basis: "condition_usual_monitoring",
    });
    expect(new Date(res.body.confirmedAt).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "clinical_relationship.confirmed", entityId: analyteEdge.id },
    });
    expect(audit).toMatchObject({ actorUserId: ownerUserId, patientProfileId: profileId, entityType: "clinical_relationship" });
  });

  it("keeps a dismissed suggestion dismissed when the inference runs again", async () => {
    const items = await relationships("suggested");
    const conceptEdge = items.find((e) => e.kind === "measurement_tracks_condition")!;
    const dismissed = await owner()(request(server()).post(`/v1/clinical-relationships/${conceptEdge.id}/dismiss`)).expect(201);
    expect(dismissed.body).toMatchObject({ status: "dismissed", dismissedByUserId: ownerUserId, verification: "unverified" });

    // The next read re-runs the inference; the answered edge must survive it.
    const after = await relationships();
    expect(after.find((e) => e.id === conceptEdge.id)).toMatchObject({ status: "dismissed" });
    expect(after.filter((e) => e.kind === "measurement_tracks_condition" && e.status === "suggested")).toEqual([]);
  });

  it("shows a confirmed link as a fact on the hub", async () => {
    const doctorEdge = (await relationships("suggested")).find((e) => e.kind === "provider_for_condition")!;
    await owner()(request(server()).post(`/v1/clinical-relationships/${doctorEdge.id}/confirm`)).expect(201);

    const hub = await owner()(request(server()).get(`/v1/profiles/current/conditions/${conditionId}/journey`)).expect(200);
    expect(hub.body.doctors).toEqual([expect.objectContaining({ id: practitionerId, displayName: "Dr. Anitha Rao" })]);
    expect(hub.body.results).toEqual([expect.objectContaining({ key: "hba1c", points: 3 })]);
    // The dismissed measurement link stays off the hub.
    expect(hub.body.measurements).toEqual([]);
  });

  // ───────────────────────── another patient's rows ─────────────────────────

  it("never lets another patient reach these rows", async () => {
    const edge = (await relationships())[0]!;
    const other = authHeaders(otherToken, otherProfileId);

    // The other patient's own graph is empty, not a view onto this one.
    const theirs = await other(request(server()).get("/v1/profiles/current/clinical-relationships")).expect(200);
    expect(theirs.body.items).toEqual([]);

    // A 404, not a 403: the id itself must not confirm the row exists.
    await other(request(server()).post(`/v1/clinical-relationships/${edge.id}/confirm`)).expect(404);
    await other(request(server()).post(`/v1/clinical-relationships/${edge.id}/dismiss`)).expect(404);
    await other(request(server()).get(`/v1/profiles/current/conditions/${conditionId}/journey`)).expect(404);
    await other(request(server()).get(`/v1/medications/${medicationId}/before-after?analyteKey=hba1c`)).expect(404);

    // And naming this profile in the header without a relationship is a 403
    // from the access layer, long before any of the above runs.
    await authHeaders(otherToken, profileId)(request(server()).get("/v1/profiles/current/clinical-relationships")).expect(403);
  });

  // ───────────────────────── before / after ─────────────────────────

  it("lines the patient's own results up against the start date, and says nothing more", async () => {
    const res = await owner()(request(server()).get(`/v1/medications/${medicationId}/before-after?analyteKey=hba1c`)).expect(200);

    expect(res.body.medication).toMatchObject({ id: medicationId, enteredName: "Metformin 500mg", startDate: START });
    expect(res.body.measure).toMatchObject({ kind: "result", key: "hba1c" });
    expect(res.body.hasEnoughPoints).toBe(true);

    const windows = windowsByKey(res.body);
    expect(windows.baseline).toMatchObject({ count: 1, average: 9.1, fromDay: -30, toDay: 0 });
    expect(windows.day30).toMatchObject({ count: 1, average: 8.2, fromDay: 15, toDay: 45 });
    expect(windows.day90).toMatchObject({ count: 1, average: 7.4, fromDay: 75, toDay: 105 });
    // The window bounds are stated absolutely so the screen never has to guess.
    expect(windows.baseline!.from).toBe("2026-01-30T00:00:00.000Z");

    expectNoVerdict(res.body);
  });

  it("does the same for a home measurement", async () => {
    const res = await owner()(request(server()).get(`/v1/medications/${medicationId}/before-after?concept=blood_glucose`)).expect(200);
    expect(res.body.measure).toMatchObject({ kind: "measurement", key: "blood_glucose" });
    const windows = windowsByKey(res.body);
    expect(windows.baseline!.average).toBe(186);
    expect(windows.day90!.average).toBe(132);
    expectNoVerdict(res.body);
  });

  it("refuses a request that names both or neither measure", async () => {
    await owner()(request(server()).get(`/v1/medications/${medicationId}/before-after`)).expect(400);
    await owner()(request(server()).get(`/v1/medications/${medicationId}/before-after?analyteKey=hba1c&concept=blood_glucose`)).expect(400);
    await owner()(request(server()).get(`/v1/medications/${medicationId}/before-after?analyteKey=not_an_analyte`)).expect(400);
  });

  it("says there is not enough data rather than inventing a window", async () => {
    const fresh = await owner()(request(server()).post("/v1/profiles/current/medications"))
      .send({ enteredName: "Amlodipine 5mg", source: "manual", startDate: "2026-08-01", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(201);
    const res = await owner()(request(server()).get(`/v1/medications/${fresh.body.id}/before-after?analyteKey=hba1c`)).expect(200);
    expect(res.body.hasEnoughPoints).toBe(false);
    for (const w of res.body.windows) expect(w.average).toBeNull();
    expectNoVerdict(res.body);
  });

  it("refuses a before/after for a medicine with no start date on file", async () => {
    const undated = await owner()(request(server()).post("/v1/profiles/current/medications"))
      .send({ enteredName: "Undated Tablet", source: "manual", instruction: { doseQuantity: 1, doseUnit: "tablet", frequencyCode: "OD" } })
      .expect(201);
    // A create always anchors `startDate` to today; a null one belongs to a
    // V1 row that predates the column, which is exactly the case that must
    // not be quietly anchored to "now" and charted as if it were real.
    await prisma.patientMedication.update({ where: { id: undated.body.id }, data: { startDate: null } });
    await owner()(request(server()).get(`/v1/medications/${undated.body.id}/before-after?analyteKey=hba1c`)).expect(400);
  });

  // ───────────────────────── caregiver scopes ─────────────────────────

  it("tells the caller which sections its scopes cover", async () => {
    const viewer = authHeaders(viewerToken, profileId);
    const hub = await viewer(request(server()).get(`/v1/profiles/current/conditions/${conditionId}/journey`)).expect(200);
    // `view_medications` still grants tests and measurements today — the
    // migration compatibility rule in packages/authorization. The hub asks
    // per section rather than assuming that, so the day the wide grants are
    // narrowed the screen degrades to an omitted section instead of a 403
    // for the whole condition.
    expect(hub.body.sections).toEqual({ medicines: true, tests: true, measurements: true });
    expect(hub.body.medicines.length).toBeGreaterThan(0);
    expect(hub.body.results).toEqual([expect.objectContaining({ key: "hba1c" })]);
  });

  it("asks for the scope that owns the numbers as well as the one that owns the medicine", async () => {
    const viewer = authHeaders(viewerToken, profileId);
    // Both gates pass for this caregiver under today's matrix; the check
    // exists so that narrowing `view_tests` later cannot leave a lab value
    // reachable through a medicines-only grant.
    await viewer(request(server()).get(`/v1/medications/${medicationId}/before-after?analyteKey=hba1c`)).expect(200);

    // A signed-in stranger with no relationship gets nothing from either gate.
    await authHeaders(otherToken, profileId)(request(server()).get(`/v1/medications/${medicationId}/before-after?analyteKey=hba1c`)).expect(403);
  });
});

type Window = { key: string; from: string; to: string; count: number; average: number | null; fromDay: number; toDay: number };

/** The three fixed windows, keyed for readable assertions. */
function windowsByKey(body: { windows: Window[] }): Record<string, Window> {
  const out: Record<string, Window> = {};
  for (const w of body.windows) out[w.key] = w;
  return out;
}

/**
 * Walks the whole payload — every key at every depth — for anything that
 * would turn "these numbers sit either side of a date" into a claim about
 * cause or improvement (docs_v2/10 §1, exit gate M10).
 */
function expectNoVerdict(payload: unknown): void {
  const forbidden = [
    "change",
    "delta",
    "difference",
    "improvement",
    "percent",
    "trend",
    "direction",
    "effect",
    "response",
    "verdict",
    "conclusion",
    "interpretation",
    "better",
    "worse",
    "cause",
    "impact",
    "benefit",
    "rating",
  ];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      const lower = key.toLowerCase();
      for (const word of forbidden) {
        if (lower.includes(word)) throw new Error(`before/after payload carries a verdict-shaped field: ${key}`);
      }
      walk(value);
    }
  };
  walk(payload);
}
