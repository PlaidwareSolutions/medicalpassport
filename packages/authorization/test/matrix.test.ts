/**
 * Phase 0 ticket 0.15 — the caregiver authorization matrix is exhaustive and
 * generated (docs_v2/03 §6). Inputs are read from their sources of truth:
 * scopes from schema.prisma, actions from the literals apps/api actually
 * passes to ProfileAccessService. Every relationship × scope × action cell
 * must produce a defined decision, and the whole matrix is committed to
 * test/matrix.snapshot.json so any policy change shows up as a reviewed
 * diff (`vitest -u` to accept one).
 */
import { CAREGIVER_SCOPES, type CaregiverScope } from "@medpass/domain";
import { describe, expect, it } from "vitest";
import {
  PROFILE_ACTIONS,
  PROFILE_SCOPE_GRANTS,
  decideProfileAccess,
  type AccessDecision,
  type ProfileAccessContext,
  type ProfileAction,
} from "../src/index.js";
import { ACCESS_SERVICE_FILE, collectApiProfileActions, readPrismaCaregiverScopes } from "./api-actions.js";

const OWNER = "owner-user";
const DEPENDENT = "dependent-user";
const CAREGIVER = "caregiver-user";

/**
 * Every distinct (userId, ownerUserId, claimedByUserId) shape the API can
 * hand to the decider. "self" and "dependent" are the same shape at this
 * level (the creator owns an unclaimed dependent profile — see
 * apps/api/src/common/profile-relationship.ts) and are listed separately so
 * the snapshot reads in the product's own vocabulary.
 */
const RELATIONSHIPS = {
  self: { userId: OWNER, profileOwnerUserId: OWNER, profileClaimedByUserId: null },
  dependent: { userId: OWNER, profileOwnerUserId: OWNER, profileClaimedByUserId: null },
  claimer: { userId: DEPENDENT, profileOwnerUserId: OWNER, profileClaimedByUserId: DEPENDENT },
  creator_after_claim: { userId: OWNER, profileOwnerUserId: OWNER, profileClaimedByUserId: DEPENDENT },
  caregiver: { userId: CAREGIVER, profileOwnerUserId: OWNER, profileClaimedByUserId: null },
  caregiver_of_claimed: { userId: CAREGIVER, profileOwnerUserId: OWNER, profileClaimedByUserId: DEPENDENT },
} as const satisfies Record<string, Omit<ProfileAccessContext, "caregiverScopes">>;

type Relationship = keyof typeof RELATIONSHIPS;
const PATIENT_RELATIONSHIPS: Relationship[] = ["self", "dependent", "claimer"];
const DELEGATED_RELATIONSHIPS: Relationship[] = ["creator_after_claim", "caregiver", "caregiver_of_claimed"];

const NO_SCOPE = "(none)";
const SCOPE_COLUMNS: (CaregiverScope | typeof NO_SCOPE)[] = [NO_SCOPE, ...CAREGIVER_SCOPES];

/** Actions that only read. Everything else changes state or delegation. */
const READ_ACTIONS: readonly ProfileAction[] = [
  "view_profile",
  "view_medications",
  "view_schedule",
  // V2 Phase 6 reads. A view-only caregiver reaching these is correct: they
  // could already read the same records through view_profile in V1.
  "view_tests",
  "view_measurements",
  "view_documents",
];
const MUTATING_ACTIONS = PROFILE_ACTIONS.filter((a) => !READ_ACTIONS.includes(a));
const VIEW_ONLY_SCOPES: readonly CaregiverScope[] = ["view_medications", "view_schedule"];

function decide(rel: Relationship, scopes: readonly CaregiverScope[], action: ProfileAction): AccessDecision {
  return decideProfileAccess({ ...RELATIONSHIPS[rel], caregiverScopes: scopes }, action);
}

function buildMatrix() {
  const matrix: Record<string, Record<string, Record<string, AccessDecision>>> = {};
  for (const rel of Object.keys(RELATIONSHIPS) as Relationship[]) {
    matrix[rel] = {};
    for (const col of SCOPE_COLUMNS) {
      const scopes = col === NO_SCOPE ? [] : [col];
      matrix[rel][col] = {};
      for (const action of PROFILE_ACTIONS) matrix[rel][col][action] = decide(rel, scopes, action);
    }
  }
  return matrix;
}

const prismaScopes = readPrismaCaregiverScopes();
const apiScan = collectApiProfileActions();

describe("caregiver matrix inputs come from their sources of truth", () => {
  it("schema.prisma CaregiverScope equals @medpass/domain CAREGIVER_SCOPES", () => {
    expect([...prismaScopes].sort()).toEqual([...CAREGIVER_SCOPES].sort());
  });

  it("every scope named in PROFILE_SCOPE_GRANTS exists in the Prisma enum", () => {
    const used = new Set(Object.values(PROFILE_SCOPE_GRANTS).flat());
    for (const scope of used) expect(prismaScopes, `unknown scope ${scope}`).toContain(scope);
  });

  it("every Prisma scope grants at least one action (no dead scopes)", () => {
    const used = new Set(Object.values(PROFILE_SCOPE_GRANTS).flat());
    for (const scope of prismaScopes) expect(used.has(scope as CaregiverScope), `dead scope ${scope}`).toBe(true);
  });

  it("apps/api resolves every profile-access call site to literal actions", () => {
    const unresolved = apiScan.callSites.filter((c) => c.unresolved);
    expect(unresolved, JSON.stringify(unresolved, null, 2)).toEqual([]);
    expect(apiScan.callSites.length).toBeGreaterThan(0);
  });

  it("decideProfileAccess is called only from ProfileAccessService in apps/api", () => {
    expect(apiScan.directDeciderCallers).toEqual([ACCESS_SERVICE_FILE]);
  });

  it("every action apps/api asks for has an explicit PROFILE_SCOPE_GRANTS entry", () => {
    const missing = apiScan.actions.filter((a) => !(a in PROFILE_SCOPE_GRANTS));
    expect(missing, `actions used by apps/api with no policy entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("every PROFILE_ACTIONS entry is asked for somewhere in apps/api (no dead policy)", () => {
    const unused = PROFILE_ACTIONS.filter((a) => !apiScan.actions.includes(a));
    expect(unused, `policy entries no endpoint requests: ${unused.join(", ")}`).toEqual([]);
  });

  it("PROFILE_ACTIONS and PROFILE_SCOPE_GRANTS keys are the same set", () => {
    expect([...Object.keys(PROFILE_SCOPE_GRANTS)].sort()).toEqual([...PROFILE_ACTIONS].sort());
  });
});

describe("every relationship × scope × action cell has a defined decision", () => {
  const relationships = Object.keys(RELATIONSHIPS) as Relationship[];

  it.each(relationships)("%s: no throw, boolean allowed, known actorRole for every scope and action", (rel) => {
    for (const col of SCOPE_COLUMNS) {
      const scopes = col === NO_SCOPE ? [] : [col];
      for (const action of PROFILE_ACTIONS) {
        let decision: AccessDecision | undefined;
        expect(() => (decision = decide(rel, scopes, action)), `${rel}/${col}/${action}`).not.toThrow();
        expect(decision, `${rel}/${col}/${action}`).toBeDefined();
        expect(typeof decision!.allowed, `${rel}/${col}/${action}`).toBe("boolean");
        expect(["patient", "caregiver", "none"], `${rel}/${col}/${action}`).toContain(decision!.actorRole);
        // Consistency: an allowed decision always names who is acting.
        if (decision!.allowed) expect(decision!.actorRole).not.toBe("none");
        else expect(decision!.actorRole).toBe("none");
      }
    }
  });

  it("actions found in apps/api are decided for every relationship and scope too", () => {
    // Same walk, but driven by the scanned literals rather than PROFILE_ACTIONS —
    // proves the scan output is a valid input to the decider, not just a subset.
    for (const rel of relationships) {
      for (const col of SCOPE_COLUMNS) {
        const scopes = col === NO_SCOPE ? [] : [col];
        for (const action of apiScan.actions) {
          const decision = decide(rel, scopes, action as ProfileAction);
          expect(typeof decision.allowed).toBe("boolean");
        }
      }
    }
  });
});

describe("relationship rules", () => {
  it.each(PATIENT_RELATIONSHIPS)("%s acts as the patient for every action regardless of scopes", (rel) => {
    for (const col of SCOPE_COLUMNS) {
      const scopes = col === NO_SCOPE ? [] : [col];
      for (const action of PROFILE_ACTIONS) {
        expect(decide(rel, scopes, action), `${rel}/${col}/${action}`).toEqual({ allowed: true, actorRole: "patient" });
      }
    }
  });

  it.each(DELEGATED_RELATIONSHIPS)("%s with no scopes is denied every action", (rel) => {
    for (const action of PROFILE_ACTIONS) {
      expect(decide(rel, [], action), `${rel}/${action}`).toEqual({ allowed: false, actorRole: "none" });
    }
  });

  it.each(DELEGATED_RELATIONSHIPS)("%s decisions follow PROFILE_SCOPE_GRANTS exactly, one scope at a time", (rel) => {
    for (const scope of CAREGIVER_SCOPES) {
      for (const action of PROFILE_ACTIONS) {
        const expected = PROFILE_SCOPE_GRANTS[action].includes(scope);
        const decision = decide(rel, [scope], action);
        expect(decision.allowed, `${rel}/${scope}/${action}`).toBe(expected);
        expect(decision.actorRole, `${rel}/${scope}/${action}`).toBe(expected ? "caregiver" : "none");
      }
    }
  });

  it("the original creator is just another caregiver once the dependent claims the profile", () => {
    for (const col of SCOPE_COLUMNS) {
      const scopes = col === NO_SCOPE ? [] : [col];
      for (const action of PROFILE_ACTIONS) {
        expect(decide("creator_after_claim", scopes, action)).toEqual(decide("caregiver", scopes, action));
      }
    }
  });
});

describe("scope invariants", () => {
  it("full_management allows everything any other scope can ever grant, except managing caregivers", () => {
    // The exception is deliberate and documented in PROFILE_SCOPE_GRANTS:
    // caregivers already hold full_management in production, and quietly
    // letting them bring more people into a patient's record is not a change
    // the patient ever agreed to. It must be granted by its own scope.
    for (const action of PROFILE_ACTIONS) {
      if (action === "manage_caregivers") {
        expect(decide("caregiver", ["full_management"], action).allowed).toBe(false);
        continue;
      }
      const grantableByAnyScope = CAREGIVER_SCOPES.some((s) => decide("caregiver", [s], action).allowed);
      if (grantableByAnyScope) {
        expect(decide("caregiver", ["full_management"], action).allowed, action).toBe(true);
      }
    }
  });

  it("full_management is not a superset of the patient: patient-only actions stay denied", () => {
    const patientOnly = PROFILE_ACTIONS.filter((a) => PROFILE_SCOPE_GRANTS[a].length === 0);
    // `manage_caregivers` left this list in V2 Phase 6 — see the policy note
    // in PROFILE_SCOPE_GRANTS. Consent and claiming stay the patient's alone:
    // consent is the legal basis for processing at all, and claiming decides
    // who owns the profile, so neither can be delegated.
    expect(patientOnly).toEqual(["manage_consents", "manage_claim"]);
    for (const action of patientOnly) {
      for (const scope of CAREGIVER_SCOPES) expect(decide("caregiver", [scope], action).allowed, `${scope}/${action}`).toBe(false);
      expect(decide("caregiver", [...CAREGIVER_SCOPES], action).allowed, action).toBe(false);
    }
  });

  it("a view-only caregiver never gets a mutating action (each view scope alone and both together)", () => {
    const scopeSets: (readonly CaregiverScope[])[] = [...VIEW_ONLY_SCOPES.map((s) => [s]), VIEW_ONLY_SCOPES];
    for (const scopes of scopeSets) {
      for (const action of MUTATING_ACTIONS) {
        expect(decide("caregiver", scopes, action).allowed, `${scopes.join("+")}/${action}`).toBe(false);
      }
    }
  });

  it("view-only scopes do grant their reads", () => {
    expect(decide("caregiver", ["view_medications"], "view_medications").allowed).toBe(true);
    expect(decide("caregiver", ["view_medications"], "view_profile").allowed).toBe(true);
    expect(decide("caregiver", ["view_schedule"], "view_schedule").allowed).toBe(true);
    expect(decide("caregiver", ["view_schedule"], "view_profile").allowed).toBe(true);
  });

  it("holding several scopes is the union of holding each (no interaction effects)", () => {
    const combos: CaregiverScope[][] = [
      ["view_medications", "record_doses"],
      ["add_medications", "edit_medications", "manage_reminders"],
      ["share_records", "review_concerns"],
      [...CAREGIVER_SCOPES].filter((s) => s !== "full_management"),
    ];
    for (const combo of combos) {
      for (const action of PROFILE_ACTIONS) {
        const union = combo.some((s) => decide("caregiver", [s], action).allowed);
        expect(decide("caregiver", combo, action).allowed, `${combo.join("+")}/${action}`).toBe(union);
      }
    }
  });
});

describe("matrix snapshot", () => {
  it("the full matrix matches test/matrix.snapshot.json (run `vitest -u` to accept a policy change)", async () => {
    const snapshot = {
      $comment:
        "Generated by packages/authorization/test/matrix.test.ts. Rows: relationship; columns: a single caregiver scope (or none); cells: decideProfileAccess(). Do not edit by hand.",
      scopes: [...prismaScopes],
      actions: [...PROFILE_ACTIONS],
      // Per file, not per line: line numbers churn on unrelated edits, and the
      // snapshot should change only when an endpoint's required action does.
      apiActionsByFile: Object.fromEntries(
        [...new Set(apiScan.callSites.map((c) => c.file))]
          .sort()
          .map((file) => [file, [...new Set(apiScan.callSites.filter((c) => c.file === file).flatMap((c) => c.actions))].sort()]),
      ),
      grants: PROFILE_SCOPE_GRANTS,
      matrix: buildMatrix(),
    };
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot("./matrix.snapshot.json");
  });
});
