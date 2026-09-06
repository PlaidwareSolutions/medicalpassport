import { describe, expect, it } from "vitest";
import { ACTOR_KINDS, type ActorKind } from "./actor.js";
import {
  MAX_VERIFICATION_BY_ACTOR,
  VerificationTransitionError,
  assertVerificationTransition,
  canTransitionVerification,
} from "./transitions.js";
import {
  VERIFICATION_STATES,
  type VerificationState,
  isHigherVerification,
  verificationRank,
} from "./verification-state.js";

/**
 * Independent oracle written out by hand from docs_v2/04 §1.2 / ADR-V2-002,
 * so the table does not re-derive the answer from the implementation.
 * The value is the set of states the actor may move a row INTO (from a lower state).
 */
const ALLOWED_TARGETS: Record<ActorKind, readonly VerificationState[]> = {
  patient: ["patient_confirmed"],
  caregiver: ["patient_confirmed"],
  provider_verified_practitioner: ["patient_confirmed", "provider_verified"],
  provider_organization: ["patient_confirmed", "provider_verified"],
  lab_system: ["patient_confirmed", "provider_verified", "source_authenticated"],
  abdm_gateway: ["patient_confirmed", "provider_verified", "source_authenticated"],
  system: [],
  admin: [],
};

const RANK: Record<VerificationState, number> = {
  unverified: 0,
  patient_confirmed: 1,
  provider_verified: 2,
  source_authenticated: 3,
};

function expected(from: VerificationState, to: VerificationState, actor: ActorKind): boolean {
  if (from === to) return true;
  if (RANK[to] < RANK[from]) return false;
  return ALLOWED_TARGETS[actor].includes(to);
}

describe("VERIFICATION_STATES ladder", () => {
  it("is ordered unverified < patient_confirmed < provider_verified < source_authenticated", () => {
    expect([...VERIFICATION_STATES]).toEqual([
      "unverified",
      "patient_confirmed",
      "provider_verified",
      "source_authenticated",
    ]);
    expect(verificationRank("unverified")).toBe(0);
    expect(verificationRank("source_authenticated")).toBe(3);
    expect(isHigherVerification("provider_verified", "patient_confirmed")).toBe(true);
    expect(isHigherVerification("patient_confirmed", "patient_confirmed")).toBe(false);
    expect(isHigherVerification("unverified", "patient_confirmed")).toBe(false);
  });
});

describe("canTransitionVerification — every (from, to) × actor", () => {
  const cases: Array<[VerificationState, VerificationState, ActorKind, boolean]> = [];
  for (const from of VERIFICATION_STATES) {
    for (const to of VERIFICATION_STATES) {
      for (const actor of ACTOR_KINDS) {
        cases.push([from, to, actor, expected(from, to, actor)]);
      }
    }
  }

  it("covers the full 4 × 4 × 8 matrix", () => {
    expect(cases).toHaveLength(VERIFICATION_STATES.length ** 2 * ACTOR_KINDS.length);
    expect(cases).toHaveLength(128);
  });

  it.each(cases)("%s → %s by %s ⇒ ok=%s", (from, to, actor, ok) => {
    const result = canTransitionVerification(from, to, actor);
    expect(result.ok).toBe(ok);
    if (!result.ok) {
      expect(result.reason).toEqual(expect.any(String));
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("canTransitionVerification — named rules", () => {
  it("same state is a no-op for every actor, including system and admin", () => {
    for (const state of VERIFICATION_STATES) {
      for (const actor of ACTOR_KINDS) {
        expect(canTransitionVerification(state, state, actor)).toEqual({ ok: true });
      }
    }
  });

  it("never moves down, for any actor", () => {
    for (const actor of ACTOR_KINDS) {
      for (const from of VERIFICATION_STATES) {
        for (const to of VERIFICATION_STATES) {
          if (RANK[to] < RANK[from]) {
            const result = canTransitionVerification(from, to, actor);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toMatch(/monotonic/);
          }
        }
      }
    }
  });

  it("patient and caregiver reach patient_confirmed only", () => {
    for (const actor of ["patient", "caregiver"] as const) {
      expect(canTransitionVerification("unverified", "patient_confirmed", actor)).toEqual({ ok: true });
      expect(canTransitionVerification("unverified", "provider_verified", actor).ok).toBe(false);
      expect(canTransitionVerification("patient_confirmed", "provider_verified", actor).ok).toBe(false);
      expect(canTransitionVerification("unverified", "source_authenticated", actor).ok).toBe(false);
    }
  });

  it("providers reach provider_verified but not source_authenticated", () => {
    for (const actor of ["provider_verified_practitioner", "provider_organization"] as const) {
      expect(canTransitionVerification("unverified", "provider_verified", actor)).toEqual({ ok: true });
      expect(canTransitionVerification("patient_confirmed", "provider_verified", actor)).toEqual({ ok: true });
      expect(canTransitionVerification("provider_verified", "source_authenticated", actor).ok).toBe(false);
      expect(canTransitionVerification("unverified", "source_authenticated", actor).ok).toBe(false);
    }
  });

  it("lab_system and abdm_gateway may set source_authenticated", () => {
    for (const actor of ["lab_system", "abdm_gateway"] as const) {
      expect(canTransitionVerification("unverified", "source_authenticated", actor)).toEqual({ ok: true });
      expect(canTransitionVerification("provider_verified", "source_authenticated", actor)).toEqual({ ok: true });
    }
  });

  it("system and admin may never raise verification (admin break-glass is read-only)", () => {
    for (const actor of ["system", "admin"] as const) {
      expect(MAX_VERIFICATION_BY_ACTOR[actor]).toBeNull();
      for (const from of VERIFICATION_STATES) {
        for (const to of VERIFICATION_STATES) {
          if (RANK[to] > RANK[from]) {
            const result = canTransitionVerification(from, to, actor);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.reason).toMatch(/may never raise/);
          }
        }
      }
    }
  });

  it("explains an entitlement failure with the actor ceiling", () => {
    const result = canTransitionVerification("unverified", "provider_verified", "patient");
    expect(result).toEqual({
      ok: false,
      reason: "actor 'patient' may raise verification at most to 'patient_confirmed', not 'provider_verified'",
    });
  });
});

describe("assertVerificationTransition", () => {
  it("returns silently on an allowed transition", () => {
    expect(() => assertVerificationTransition("unverified", "patient_confirmed", "patient")).not.toThrow();
    expect(() => assertVerificationTransition("provider_verified", "provider_verified", "admin")).not.toThrow();
  });

  it("throws a typed VerificationTransitionError otherwise", () => {
    try {
      assertVerificationTransition("provider_verified", "unverified", "lab_system");
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(VerificationTransitionError);
      const e = err as VerificationTransitionError;
      expect(e.name).toBe("VerificationTransitionError");
      expect(e.code).toBe("invalid_status_transition");
      expect(e.from).toBe("provider_verified");
      expect(e.to).toBe("unverified");
      expect(e.actor).toBe("lab_system");
      expect(e.message).toMatch(/monotonic/);
    }
  });
});
