import { describe, expect, it } from "vitest";
import { emitHealthEvent, supersedeHealthEvents } from "./index";
import { localIso } from "./local-time";
import {
  dateOnlyToInstant,
  medicationChangeKind,
  projectAllergy,
  projectCondition,
  projectEncounter,
  projectMedicationChange,
  projectPrescription,
  projectReport,
} from "./projectors";

const ctx = { patientProfileId: "11111111-1111-4111-8111-111111111111", timezone: "Asia/Kolkata" };

function fakeTx() {
  const upserts: unknown[] = [];
  const updates: unknown[] = [];
  const tx = {
    healthEvent: {
      upsert: async (args: unknown) => {
        upserts.push(args);
        return { id: "e1" };
      },
      updateMany: async (args: unknown) => {
        updates.push(args);
        return { count: 2 };
      },
    },
  };
  return { tx: tx as never, upserts, updates };
}

describe("localIso", () => {
  it("renders the patient's wall clock without an offset", () => {
    expect(localIso(new Date("2026-09-06T15:35:00Z"), "Asia/Kolkata")).toBe("2026-09-06T21:05:00");
    expect(localIso(new Date("2026-09-06T15:35:00Z"), "America/Chicago")).toBe("2026-09-06T10:35:00");
    expect(localIso(new Date("2026-09-06T18:30:00Z"), "Asia/Kolkata")).toBe("2026-09-07T00:00:00");
  });
});

describe("dateOnlyToInstant", () => {
  it("anchors a @db.Date to local noon so it sorts inside the right calendar day", () => {
    const at = dateOnlyToInstant(new Date("2026-03-15T00:00:00Z"), "Asia/Kolkata");
    expect(localIso(at, "Asia/Kolkata")).toBe("2026-03-15T12:00:00");
    const chicago = dateOnlyToInstant(new Date("2026-03-15T00:00:00Z"), "America/Chicago");
    expect(localIso(chicago, "America/Chicago")).toBe("2026-03-15T12:00:00");
  });
});

describe("emitHealthEvent", () => {
  it("upserts on the idempotency key and fills defaults", async () => {
    const { tx, upserts } = fakeTx();
    const at = new Date("2026-09-06T10:00:00Z");
    await emitHealthEvent(tx, {
      patientProfileId: ctx.patientProfileId,
      kind: "allergy_recorded",
      entityType: "patient_allergy",
      entityId: "a1",
      occurredAt: at,
      summary: { label: "Dust" },
    });
    const call = upserts[0] as { where: { entityType_entityId_kind_occurredAt: Record<string, unknown> }; create: Record<string, unknown>; update: Record<string, unknown> };
    expect(call.where.entityType_entityId_kind_occurredAt).toEqual({ entityType: "patient_allergy", entityId: "a1", kind: "allergy_recorded", occurredAt: at });
    expect(call.create.actorType).toBe("patient");
    expect(call.create.summary).toEqual({ label: "Dust" });
    expect(call.update.supersededAt).toBeNull();
  });

  it("supersedes every live event of an entity, never deletes", async () => {
    const { tx, updates } = fakeTx();
    const count = await supersedeHealthEvents(tx, "patient_allergy", "a1", new Date("2026-01-01T00:00:00Z"));
    expect(count).toBe(2);
    expect((updates[0] as { where: unknown }).where).toEqual({ entityType: "patient_allergy", entityId: "a1", supersededAt: null });
  });
});

describe("projectors", () => {
  it("allergy → allergy_recorded at recording time with provenance copied", () => {
    const e = projectAllergy(ctx, { id: "a1", label: "Penicillin", severity: "severe", createdAt: new Date("2026-09-06T10:00:00Z"), provenanceSource: "user_entered", verification: "patient_confirmed", recordedByUserId: "u1" });
    expect(e.kind).toBe("allergy_recorded");
    expect(e.occurredAtLocal).toBe("2026-09-06T15:30:00");
    expect(e.provenanceSource).toBe("user_entered");
    expect(e.verification).toBe("patient_confirmed");
    expect(e.actorUserId).toBe("u1");
  });

  it("condition prefers onset date over recording date and says which", () => {
    const withOnset = projectCondition(ctx, { id: "c1", label: "Type 2 diabetes", onsetDate: new Date("2020-01-10T00:00:00Z"), createdAt: new Date("2026-09-06T10:00:00Z") });
    expect(withOnset.occurredAtLocal?.startsWith("2020-01-10")).toBe(true);
    expect(withOnset.summary.dateSource).toBe("onset");
    const without = projectCondition(ctx, { id: "c2", label: "Asthma", createdAt: new Date("2026-09-06T10:00:00Z") });
    expect(without.summary.dateSource).toBe("recorded");
  });

  it("prescription uses the prescribed date when the patient recorded one", () => {
    const e = projectPrescription(ctx, { id: "p1", prescribedAt: new Date("2026-08-01T00:00:00Z"), createdAt: new Date("2026-09-06T10:00:00Z"), practitionerName: "Dr. Rao", medicineCount: 3, encounterId: "enc1" });
    expect(e.kind).toBe("prescription");
    expect(e.encounterId).toBe("enc1");
    expect(e.occurredAtLocal?.startsWith("2026-08-01")).toBe(true);
  });

  it("maps medication change strings onto timeline kinds", () => {
    expect(medicationChangeKind("created")).toBe("medicine_started");
    expect(medicationChangeKind("stopped")).toBe("medicine_stopped");
    expect(medicationChangeKind("status_changed", { to: "paused" })).toBe("medicine_paused");
    expect(medicationChangeKind("status_changed", { to: "current" })).toBe("medicine_resumed");
    expect(medicationChangeKind("something_new")).toBe("medicine_changed");
    const e = projectMedicationChange(ctx, { id: "m1", enteredName: "Metformin 500", provenanceSource: "ocr_extracted", verification: "patient_confirmed" }, { id: "ch1", change: "created", actorUserId: "u9", occurredAt: new Date("2026-09-01T00:00:00Z") });
    expect(e.entityType).toBe("medication_change");
    expect(e.summary.name).toBe("Metformin 500");
    expect(e.actorUserId).toBe("u9");
    expect(e.provenanceSource).toBe("ocr_extracted");
  });

  it("imaging reports become imaging_report, everything else test_result", () => {
    expect(projectReport(ctx, { id: "r1", kind: "imaging", createdAt: new Date() }).kind).toBe("imaging_report");
    expect(projectReport(ctx, { id: "r2", kind: "blood_test", createdAt: new Date() }).kind).toBe("test_result");
  });

  it("inpatient encounters produce admission and discharge events", () => {
    const events = projectEncounter(ctx, { id: "e1", kind: "inpatient", startedAt: new Date("2026-05-01T04:00:00Z"), endedAt: new Date("2026-05-04T06:00:00Z"), organizationName: "Care Hospital" });
    expect(events.map((e) => e.kind)).toEqual(["hospital_admission", "discharge"]);
    expect(events[0]?.encounterId).toBe("e1");
    expect(projectEncounter(ctx, { id: "e2", kind: "outpatient", startedAt: new Date() }).map((e) => e.kind)).toEqual(["doctor_visit"]);
  });
});
