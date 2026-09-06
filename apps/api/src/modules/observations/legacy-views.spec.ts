import { toLegacyBloodPressure, toLegacyGlucose, toLegacyWeight, type LegacyObservationRow } from "./legacy-views";

function row(over: Partial<LegacyObservationRow> = {}): LegacyObservationRow {
  return {
    id: "obs-1",
    patientProfileId: "profile-1",
    concept: "blood_glucose",
    valueNumeric: "118",
    valueNumeric2: null,
    context: "before_breakfast",
    measuredAt: new Date("2026-09-01T07:00:00.000Z"),
    notes: "slept badly",
    legacyEntityType: null,
    legacyId: null,
    recordedByUserId: "user-1",
    createdAt: new Date("2026-09-01T07:01:00.000Z"),
    updatedAt: new Date("2026-09-01T07:01:00.000Z"),
    provenanceSource: "user_entered",
    verification: "patient_confirmed",
    recordedVia: "pwa",
    sourceDocumentId: null,
    sourceExtractionId: null,
    ...over,
  };
}

describe("V1 reading views over Observation", () => {
  it("a V2-born glucose reading takes the V1 shape under its own id", () => {
    const dto = toLegacyGlucose(row());
    expect(dto).toMatchObject({ id: "obs-1", context: "before_breakfast", valueMgDl: 118, note: "slept badly", deletedAt: null });
    expect(dto).not.toHaveProperty("concept");
  });

  it("a mirrored reading answers to its V1 id, so a V1 delete by that id still works", () => {
    expect(toLegacyGlucose(row({ legacyEntityType: "glucose_reading", legacyId: "v1-abc" })).id).toBe("v1-abc");
  });

  it("a context V1 never had reads as random rather than failing the V1 enum", () => {
    expect(toLegacyGlucose(row({ context: "fasting" })).context).toBe("random");
    expect(toLegacyGlucose(row({ context: null })).context).toBe("random");
  });

  it("blood pressure finds its pulse by legacy id first, then by the measured instant", () => {
    const at = new Date("2026-09-02T07:00:00.000Z");
    const bp = row({ concept: "blood_pressure", valueNumeric: "136", valueNumeric2: "84", measuredAt: at, legacyId: "v1-bp" });
    const byId = row({ id: "pulse-1", concept: "heart_rate", valueNumeric: "71", legacyEntityType: "blood_pressure_reading_pulse", legacyId: "v1-bp", measuredAt: new Date("2000-01-01") });
    const byTime = row({ id: "pulse-2", concept: "heart_rate", valueNumeric: "99", measuredAt: at });
    expect(toLegacyBloodPressure(bp, [byTime, byId])).toMatchObject({ id: "v1-bp", systolic: 136, diastolic: 84, pulseBpm: 71 });
    expect(toLegacyBloodPressure(row({ ...bp, legacyId: null, id: "obs-bp" }), [byTime])).toMatchObject({ id: "obs-bp", pulseBpm: 99 });
    expect(toLegacyBloodPressure(row({ ...bp, legacyId: null }), []).pulseBpm).toBeNull();
  });

  it("weight keeps the decimal as a string, the way Prisma serialises the V1 column", () => {
    expect(toLegacyWeight(row({ concept: "body_weight", valueNumeric: "72.4" })).weightKg).toBe("72.4");
  });
});
