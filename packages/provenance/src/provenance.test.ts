import { describe, expect, it } from "vitest";
import { ACTOR_KINDS, isActorKind } from "./actor.js";
import {
  ClientProvenanceError,
  assertNoClientProvenance,
  findClientProvenanceKeys,
  stripClientProvenance,
} from "./client-guard.js";
import {
  PROVENANCE_KEYS,
  type ProvenanceBlock,
  actorKindSchema,
  provenanceBlockInputSchema,
  provenanceBlockSchema,
} from "./provenance-block.js";
import {
  LEGACY_RECORD_SOURCES,
  LEGACY_RECORD_SOURCE_MAP,
  RECORD_SOURCES,
  isLegacyRecordSource,
  isRecordSource,
  normalizeRecordSource,
} from "./record-source.js";
import { RECORDED_VIA, isRecordedVia } from "./recorded-via.js";
import { VERIFICATION_STATES, isVerificationState } from "./verification-state.js";

const UUID = "3f2c1a9e-7b4d-4c1e-9a8b-2d5e6f7a8b9c";

describe("vocabularies", () => {
  it("RECORD_SOURCES matches docs_v2/04 §1.2", () => {
    expect([...RECORD_SOURCES]).toEqual([
      "user_entered",
      "caregiver_entered",
      "ocr_extracted",
      "clinic_entered",
      "lab_imported",
      "pharmacy_entered",
      "device_recorded",
      "abdm_imported",
      "system_derived",
    ]);
    expect(isRecordSource("ocr_extracted")).toBe(true);
    expect(isRecordSource("patient")).toBe(false);
    expect(isRecordSource(null)).toBe(false);
  });

  it("legacy V1 values map onto V2 sources and every legacy value is covered", () => {
    expect(LEGACY_RECORD_SOURCE_MAP).toEqual({
      patient: "user_entered",
      document: "ocr_extracted",
      professional: "clinic_entered",
    });
    for (const legacy of LEGACY_RECORD_SOURCES) {
      expect(isLegacyRecordSource(legacy)).toBe(true);
      expect(isRecordSource(LEGACY_RECORD_SOURCE_MAP[legacy])).toBe(true);
      expect(normalizeRecordSource(legacy)).toBe(LEGACY_RECORD_SOURCE_MAP[legacy]);
    }
    expect(normalizeRecordSource("lab_imported")).toBe("lab_imported");
    expect(isLegacyRecordSource("user_entered")).toBe(false);
  });

  it("VERIFICATION_STATES, RECORDED_VIA and ACTOR_KINDS are the documented allowlists", () => {
    expect([...VERIFICATION_STATES]).toEqual([
      "unverified",
      "patient_confirmed",
      "provider_verified",
      "source_authenticated",
    ]);
    expect([...RECORDED_VIA]).toEqual([
      "pwa",
      "native_android",
      "native_ios",
      "clinic_portal",
      "pharmacy_portal",
      "lab_api",
      "abdm",
      "worker",
    ]);
    expect([...ACTOR_KINDS]).toEqual([
      "patient",
      "caregiver",
      "provider_verified_practitioner",
      "provider_organization",
      "lab_system",
      "abdm_gateway",
      "system",
      "admin",
    ]);
    expect(isVerificationState("provider_verified")).toBe(true);
    expect(isVerificationState("verified")).toBe(false);
    expect(isRecordedVia("worker")).toBe(true);
    expect(isRecordedVia("curl")).toBe(false);
    expect(isActorKind("abdm_gateway")).toBe(true);
    expect(isActorKind("root")).toBe(false);
    expect(actorKindSchema.safeParse("admin").success).toBe(true);
    expect(actorKindSchema.safeParse("nobody").success).toBe(false);
  });
});

describe("provenanceBlockSchema", () => {
  const full: ProvenanceBlock = {
    source: "lab_imported",
    verification: "source_authenticated",
    recordedVia: "lab_api",
    recordedByUserId: null,
    sourceDocumentId: UUID,
    sourceExtractionId: null,
    sourceDeviceId: null,
    sourceAbdmTxnId: null,
    sourceOrganizationId: UUID,
    sourcePractitionerId: null,
    verifiedByUserId: null,
    verifiedAt: new Date("2026-09-01T00:00:00Z"),
  };

  it("PROVENANCE_KEYS lists exactly the docs_v2/04 §1.2 columns and the schema has the same keys", () => {
    expect([...PROVENANCE_KEYS]).toEqual([
      "source",
      "verification",
      "recordedVia",
      "recordedByUserId",
      "sourceDocumentId",
      "sourceExtractionId",
      "sourceDeviceId",
      "sourceAbdmTxnId",
      "sourceOrganizationId",
      "sourcePractitionerId",
      "verifiedByUserId",
      "verifiedAt",
    ]);
    expect(Object.keys(provenanceBlockSchema.shape).sort()).toEqual([...PROVENANCE_KEYS].sort());
  });

  it("accepts a complete block", () => {
    expect(provenanceBlockSchema.parse(full)).toEqual(full);
  });

  it("coerces ISO strings to Date for verifiedAt", () => {
    const parsed = provenanceBlockSchema.parse({ ...full, verifiedAt: "2026-09-01T00:00:00Z" });
    expect(parsed.verifiedAt).toBeInstanceOf(Date);
    expect(parsed.verifiedAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rejects unknown source / verification / recordedVia values", () => {
    expect(provenanceBlockSchema.safeParse({ ...full, source: "patient" }).success).toBe(false);
    expect(provenanceBlockSchema.safeParse({ ...full, verification: "trusted" }).success).toBe(false);
    expect(provenanceBlockSchema.safeParse({ ...full, recordedVia: "postman" }).success).toBe(false);
  });

  it("rejects non-uuid link ids and unknown keys (strict)", () => {
    expect(provenanceBlockSchema.safeParse({ ...full, sourceDeviceId: "device-1" }).success).toBe(false);
    expect(provenanceBlockSchema.safeParse({ ...full, extra: true }).success).toBe(false);
  });

  it("requires every column on a persisted row", () => {
    const { verifiedAt: _verifiedAt, ...missing } = full;
    expect(provenanceBlockSchema.safeParse(missing).success).toBe(false);
  });

  it("input schema defaults every link to null but still requires the three mandatory columns", () => {
    const parsed = provenanceBlockInputSchema.parse({
      source: "user_entered",
      verification: "patient_confirmed",
      recordedVia: "pwa",
    });
    expect(parsed).toEqual({
      source: "user_entered",
      verification: "patient_confirmed",
      recordedVia: "pwa",
      recordedByUserId: null,
      sourceDocumentId: null,
      sourceExtractionId: null,
      sourceDeviceId: null,
      sourceAbdmTxnId: null,
      sourceOrganizationId: null,
      sourcePractitionerId: null,
      verifiedByUserId: null,
      verifiedAt: null,
    });
    expect(provenanceBlockInputSchema.safeParse({ source: "user_entered", verification: "unverified" }).success).toBe(
      false,
    );
    expect(provenanceBlockSchema.safeParse(parsed).success).toBe(true);
  });
});

describe("assertNoClientProvenance", () => {
  it("passes a clean client payload through", () => {
    expect(() => assertNoClientProvenance({ name: "Metformin", dose: "500 mg", notes: null })).not.toThrow();
    expect(() => assertNoClientProvenance({})).not.toThrow();
  });

  it("ignores non-object payloads", () => {
    for (const payload of [null, undefined, "source", 42, true, ["source", "verification"]]) {
      expect(() => assertNoClientProvenance(payload)).not.toThrow();
      expect(findClientProvenanceKeys(payload)).toEqual([]);
    }
  });

  it.each([...PROVENANCE_KEYS])("throws when the client sends `%s`", (key) => {
    expect(() => assertNoClientProvenance({ name: "x", [key]: "anything" })).toThrow(ClientProvenanceError);
  });

  it("presence is the violation, even with an undefined or null value", () => {
    expect(() => assertNoClientProvenance({ source: undefined })).toThrow(ClientProvenanceError);
    expect(() => assertNoClientProvenance({ verifiedAt: null })).toThrow(ClientProvenanceError);
  });

  it("reports every offending key, in canonical order, on a typed error", () => {
    try {
      assertNoClientProvenance({ verifiedAt: "now", name: "x", source: "clinic_entered", verification: "provider_verified" });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ClientProvenanceError);
      const e = err as ClientProvenanceError;
      expect(e.name).toBe("ClientProvenanceError");
      expect(e.code).toBe("validation_failed");
      expect(e.keys).toEqual(["source", "verification", "verifiedAt"]);
      expect(e.message).toBe("client payload may not set provenance field(s): source, verification, verifiedAt");
    }
  });

  it("does not look at inherited keys", () => {
    const proto = { source: "user_entered" };
    const payload = Object.create(proto) as Record<string, unknown>;
    payload["name"] = "x";
    expect(() => assertNoClientProvenance(payload)).not.toThrow();
  });

  it("does not look into nested objects (the guard is per DTO level)", () => {
    expect(() => assertNoClientProvenance({ nested: { source: "user_entered" } })).not.toThrow();
  });
});

describe("stripClientProvenance", () => {
  it("returns a copy without any provenance keys and leaves the input untouched", () => {
    const input = { name: "x", source: "user_entered", verification: "provider_verified", verifiedAt: "now" };
    const out = stripClientProvenance(input);
    expect(out).toEqual({ name: "x" });
    expect(input).toHaveProperty("source");
    expect(findClientProvenanceKeys(out)).toEqual([]);
  });
});
