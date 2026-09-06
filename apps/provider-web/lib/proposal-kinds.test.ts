import { describe, expect, it } from "vitest";
import { allowedProposalKinds, canSend, isProposalKind, organizationMode, PROPOSAL_KIND_META, PROPOSAL_KINDS, proposalStatusLabel } from "./proposal-kinds";

describe("allowedProposalKinds (docs_v2/05 §11)", () => {
  it("mirrors the API table per organization kind", () => {
    expect(allowedProposalKinds("clinic")).toEqual(["reconciliation", "prescription", "encounter"]);
    expect(allowedProposalKinds("hospital")).toEqual(["reconciliation", "prescription", "encounter", "discharge_transition"]);
    expect(allowedProposalKinds("pharmacy")).toEqual(["dispense"]);
    expect(allowedProposalKinds("laboratory")).toEqual(["diagnostic_report"]);
    expect(allowedProposalKinds("diagnostic_centre")).toEqual(["diagnostic_report"]);
    expect(allowedProposalKinds("other")).toEqual([]);
  });

  it("offers nothing for an unknown kind", () => {
    expect(allowedProposalKinds("spa")).toEqual([]);
  });

  it("the server list can only narrow, never widen", () => {
    // Server allows less than the local table: intersection.
    expect(allowedProposalKinds("hospital", ["reconciliation", "encounter"])).toEqual(["reconciliation", "encounter"]);
    // Server allows something the local table (and this build) has no screen for: dropped.
    expect(allowedProposalKinds("pharmacy", ["dispense", "reconciliation", "future_kind"])).toEqual(["dispense"]);
    // Server allows nothing: nothing offered.
    expect(allowedProposalKinds("clinic", [])).toEqual([]);
  });

  it("canSend gates the workflow screens the same way", () => {
    expect(canSend("clinic", "discharge_transition")).toBe(false);
    expect(canSend("hospital", "discharge_transition")).toBe(true);
    expect(canSend("pharmacy", "reconciliation")).toBe(false);
    expect(canSend("laboratory", "diagnostic_report", ["diagnostic_report"])).toBe(true);
    expect(canSend("laboratory", "diagnostic_report", [])).toBe(false);
  });

  it("every kind has a screen route and an API segment", () => {
    for (const kind of PROPOSAL_KINDS) {
      expect(isProposalKind(kind)).toBe(true);
      expect(PROPOSAL_KIND_META[kind].route).toMatch(/^[a-z-]+$/);
      expect(PROPOSAL_KIND_META[kind].apiSegment).toMatch(/^[a-z-]+$/);
    }
    expect(isProposalKind("consent")).toBe(false);
  });

  it("status copy: proposed reads as awaiting acceptance", () => {
    expect(proposalStatusLabel("proposed")).toEqual({ label: "Awaiting the patient's acceptance", tone: "warning" });
    expect(proposalStatusLabel("accepted").tone).toBe("success");
    expect(proposalStatusLabel("rejected").tone).toBe("danger");
    expect(proposalStatusLabel("expired").tone).toBe("default");
  });

  it("mode is copy only, derived from kind", () => {
    expect(organizationMode("diagnostic_centre")).toBe("laboratory");
    expect(organizationMode("other")).toBe("none");
  });
});
