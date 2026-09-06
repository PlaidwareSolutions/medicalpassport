import { describe, expect, it } from "vitest";
import { ACTOR_KINDS, type ActorKind } from "./actor.js";
import { initialVerificationFor } from "./initial-verification.js";
import { RECORD_SOURCES, type RecordSource } from "./record-source.js";
import { canTransitionVerification } from "./transitions.js";
import type { VerificationState } from "./verification-state.js";

/** Hand-written oracle (docs_v2/04 §1.2, ticket 0.11 item 6). */
function expected(source: RecordSource, actor: ActorKind): VerificationState {
  const isPatientSide = actor === "patient" || actor === "caregiver";
  const isProvider = actor === "provider_verified_practitioner" || actor === "provider_organization";
  switch (source) {
    case "user_entered":
    case "caregiver_entered":
      return isPatientSide ? "patient_confirmed" : "unverified";
    case "clinic_entered":
    case "pharmacy_entered":
      return isProvider ? "provider_verified" : "unverified";
    case "lab_imported":
      return actor === "lab_system" ? "source_authenticated" : "unverified";
    case "abdm_imported":
      return actor === "abdm_gateway" ? "source_authenticated" : "unverified";
    case "ocr_extracted":
    case "device_recorded":
    case "system_derived":
      return "unverified";
  }
}

describe("initialVerificationFor — every source × actor", () => {
  const cases: Array<[RecordSource, ActorKind, VerificationState]> = [];
  for (const source of RECORD_SOURCES) {
    for (const actor of ACTOR_KINDS) cases.push([source, actor, expected(source, actor)]);
  }

  it("covers the full 9 × 8 matrix", () => {
    expect(cases).toHaveLength(72);
  });

  it.each(cases)("%s by %s ⇒ %s", (source, actor, state) => {
    expect(initialVerificationFor(source, actor)).toBe(state);
  });

  it("never grants an initial state the actor could not reach via the state machine", () => {
    for (const [source, actor] of cases) {
      const state = initialVerificationFor(source, actor);
      if (state !== "unverified") {
        expect(canTransitionVerification("unverified", state, actor)).toEqual({ ok: true });
      }
    }
  });
});

describe("initialVerificationFor — named rules", () => {
  it("user/caregiver entry by the patient side starts patient_confirmed", () => {
    expect(initialVerificationFor("user_entered", "patient")).toBe("patient_confirmed");
    expect(initialVerificationFor("caregiver_entered", "caregiver")).toBe("patient_confirmed");
    expect(initialVerificationFor("user_entered", "caregiver")).toBe("patient_confirmed");
  });

  it("user_entered saved by anyone else starts unverified", () => {
    expect(initialVerificationFor("user_entered", "system")).toBe("unverified");
    expect(initialVerificationFor("user_entered", "admin")).toBe("unverified");
    expect(initialVerificationFor("user_entered", "provider_verified_practitioner")).toBe("unverified");
  });

  it("OCR and ABDM-imported data stay unverified until confirmed", () => {
    for (const actor of ACTOR_KINDS) expect(initialVerificationFor("ocr_extracted", actor)).toBe("unverified");
    expect(initialVerificationFor("abdm_imported", "patient")).toBe("unverified");
    expect(initialVerificationFor("abdm_imported", "system")).toBe("unverified");
  });

  it("an ABDM gateway import arrives source_authenticated", () => {
    expect(initialVerificationFor("abdm_imported", "abdm_gateway")).toBe("source_authenticated");
  });

  it("lab_imported via lab_system is source_authenticated; via anyone else unverified", () => {
    expect(initialVerificationFor("lab_imported", "lab_system")).toBe("source_authenticated");
    expect(initialVerificationFor("lab_imported", "patient")).toBe("unverified");
    expect(initialVerificationFor("lab_imported", "abdm_gateway")).toBe("unverified");
  });

  it("clinic_entered via a provider is provider_verified; via anyone else unverified", () => {
    expect(initialVerificationFor("clinic_entered", "provider_verified_practitioner")).toBe("provider_verified");
    expect(initialVerificationFor("clinic_entered", "provider_organization")).toBe("provider_verified");
    expect(initialVerificationFor("clinic_entered", "patient")).toBe("unverified");
    expect(initialVerificationFor("clinic_entered", "admin")).toBe("unverified");
  });

  it("device_recorded and system_derived are always unverified", () => {
    for (const actor of ACTOR_KINDS) {
      expect(initialVerificationFor("device_recorded", actor)).toBe("unverified");
      expect(initialVerificationFor("system_derived", actor)).toBe("unverified");
    }
  });
});
