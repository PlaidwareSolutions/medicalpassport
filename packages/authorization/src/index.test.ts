import { describe, expect, it } from "vitest";
import { decideProfileAccess } from "./index.js";

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
