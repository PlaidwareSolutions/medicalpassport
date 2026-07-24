import { describe, expect, it } from "vitest";
import { decideAdminAccess, decideProfileAccess } from "./index.js";

const owner = "owner-1";
const caregiver = "cg-1";

describe("decideProfileAccess", () => {
  it("lets the owner do everything", () => {
    for (const action of ["view_medications", "edit_medications", "manage_caregivers"] as const) {
      expect(decideProfileAccess({ userId: owner, profileOwnerUserId: owner }, action).allowed).toBe(true);
    }
  });

  it("the claimer (dependent who took over) outranks the creating caregiver", () => {
    const ctx = { userId: owner, profileOwnerUserId: owner, profileClaimedByUserId: "dependent-1" };
    expect(decideProfileAccess(ctx, "manage_caregivers").allowed).toBe(false);
    expect(
      decideProfileAccess(
        { userId: "dependent-1", profileOwnerUserId: owner, profileClaimedByUserId: "dependent-1" },
        "manage_caregivers",
      ).allowed,
    ).toBe(true);
  });

  it("caregiver scope grants exactly the matching actions", () => {
    const ctx = { userId: caregiver, profileOwnerUserId: owner, caregiverScopes: ["record_doses"] as const };
    expect(decideProfileAccess(ctx, "record_doses").allowed).toBe(true);
    expect(decideProfileAccess(ctx, "edit_medications").allowed).toBe(false);
  });

  it("full_management grants everything except caregiver/consent management", () => {
    const ctx = { userId: caregiver, profileOwnerUserId: owner, caregiverScopes: ["full_management"] as const };
    expect(decideProfileAccess(ctx, "edit_medications").allowed).toBe(true);
    expect(decideProfileAccess(ctx, "manage_caregivers").allowed).toBe(false);
    expect(decideProfileAccess(ctx, "manage_consents").allowed).toBe(false);
  });

  it("no relationship means no access", () => {
    expect(decideProfileAccess({ userId: "stranger", profileOwnerUserId: owner }, "view_medications").allowed).toBe(
      false,
    );
  });
});

describe("decideAdminAccess", () => {
  it("super_admin grants every action, including ones with no other duty", () => {
    for (const action of [
      "read_catalog",
      "propose_catalog_change",
      "decide_catalog_change",
      "read_content",
      "propose_content_change",
      "decide_content_change",
      "search_audit",
      "replay_job",
      "revoke_share",
      "view_operations",
      "view_rules",
    ] as const) {
      expect(decideAdminAccess(["super_admin"], action)).toBe(true);
    }
  });

  it("read_catalog and read_content require no specific duty — any authenticated admin", () => {
    expect(decideAdminAccess([], "read_catalog")).toBe(true);
    expect(decideAdminAccess(["audit_search"], "read_catalog")).toBe(true);
    expect(decideAdminAccess([], "read_content")).toBe(true);
    expect(decideAdminAccess(["audit_search"], "read_content")).toBe(true);
  });

  it("a duty grants exactly its matching action, not others", () => {
    expect(decideAdminAccess(["catalog_write"], "propose_catalog_change")).toBe(true);
    expect(decideAdminAccess(["catalog_write"], "decide_catalog_change")).toBe(false);
    expect(decideAdminAccess(["audit_search"], "search_audit")).toBe(true);
    expect(decideAdminAccess(["audit_search"], "replay_job")).toBe(false);
  });

  it("content_write/content_approve are distinct from catalog_write/catalog_approve", () => {
    expect(decideAdminAccess(["catalog_write"], "propose_content_change")).toBe(false);
    expect(decideAdminAccess(["catalog_approve"], "decide_content_change")).toBe(false);
    expect(decideAdminAccess(["content_write"], "propose_content_change")).toBe(true);
    expect(decideAdminAccess(["content_write"], "decide_content_change")).toBe(false);
    expect(decideAdminAccess(["content_approve"], "decide_content_change")).toBe(true);
  });

  it("incident_response grants both job replay and share revoke", () => {
    expect(decideAdminAccess(["incident_response"], "replay_job")).toBe(true);
    expect(decideAdminAccess(["incident_response"], "revoke_share")).toBe(true);
  });

  it("no duties means no gated access", () => {
    expect(decideAdminAccess([], "search_audit")).toBe(false);
    expect(decideAdminAccess([], "view_operations")).toBe(false);
  });
});
