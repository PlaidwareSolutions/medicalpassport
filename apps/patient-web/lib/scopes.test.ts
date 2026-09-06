import { describe, expect, it } from "vitest";
import { CAREGIVER_SCOPES } from "@medpass/domain";
import { en } from "@medpass/localization/dist/dictionaries/en.js";
import { PROFILE_ACTIONS, PROFILE_SCOPE_GRANTS, actionLabelKey, scopeLabelKey, scopesGrant } from "./scopes";

/**
 * These assertions mirror `packages/authorization`'s own matrix test. The
 * client copy of the grant table is a convenience layer — the server is the
 * only authority — but a copy that drifts is worse than no copy at all: it
 * would hide a control the caregiver may actually use, or show one that
 * 403s. The cases below are the ones where drift would be most damaging.
 */
describe("scopesGrant", () => {
  it("full_management grants the everyday actions", () => {
    for (const action of ["edit_medications", "record_doses", "share_records", "upload_documents"] as const) {
      expect(scopesGrant(["full_management"], action), action).toBe(true);
    }
  });

  it("full_management does NOT grant manage_caregivers — only its own named scope does", () => {
    // The documented exception (docs_v2/04 §2.2): a power that changes who
    // else can read the record is granted deliberately or not at all.
    expect(scopesGrant(["full_management"], "manage_caregivers")).toBe(false);
    expect(scopesGrant(["manage_caregivers"], "manage_caregivers")).toBe(true);
  });

  it("consent and claiming are patient-only — no scope grants them", () => {
    for (const scope of CAREGIVER_SCOPES) {
      expect(scopesGrant([scope], "manage_consents"), scope).toBe(false);
      expect(scopesGrant([scope], "manage_claim"), scope).toBe(false);
    }
  });

  it("the old broad scopes keep granting the reads that used to live under view_profile", () => {
    // Otherwise shipping the narrow scopes would take access away from
    // caregivers who already have it — a regression dressed as a fix.
    for (const action of ["view_tests", "view_measurements", "view_documents"] as const) {
      expect(scopesGrant(["view_medications"], action), action).toBe(true);
      expect(scopesGrant(["manage_profile"], action), action).toBe(true);
    }
  });

  it("a read scope never grants the matching write", () => {
    expect(scopesGrant(["view_tests"], "upload_tests")).toBe(false);
    expect(scopesGrant(["view_measurements"], "add_measurements")).toBe(false);
    expect(scopesGrant(["view_documents"], "upload_documents")).toBe(false);
    expect(scopesGrant(["view_medications"], "edit_medications")).toBe(false);
  });

  it("no scopes grants nothing", () => {
    for (const action of PROFILE_ACTIONS) {
      expect(scopesGrant([], action), action).toBe(false);
    }
  });
});

describe("copy", () => {
  it("every action and every scope has a plain-words label, so a notice never prints a code", () => {
    for (const action of PROFILE_ACTIONS) {
      expect(en[actionLabelKey(action) as keyof typeof en], action).toBeTruthy();
    }
    for (const scope of CAREGIVER_SCOPES) {
      expect(en[scopeLabelKey(scope) as keyof typeof en], scope).toBeTruthy();
    }
  });

  it("every action in the grant table is a known action", () => {
    expect(Object.keys(PROFILE_SCOPE_GRANTS).sort()).toEqual([...PROFILE_ACTIONS].sort());
  });
});
