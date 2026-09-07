import { describe, expect, it } from "vitest";
import { groupPatientLinks, sectionLabels } from "./patient-links";
import type { PatientLinkDto } from "./types";

const link = (linkId: string, displayName: string, over: Partial<PatientLinkDto> = {}): PatientLinkDto => ({
  linkId,
  patient: { displayName, yearOfBirth: 1960, sex: "male" },
  sections: ["medications"],
  status: "active",
  expiresAt: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

const label = (l: PatientLinkDto) => `${l.patient?.displayName} · born ${l.patient?.yearOfBirth}`;

describe("groupPatientLinks", () => {
  it("marks each of the links one organization holds for the same patient", () => {
    const rows = groupPatientLinks([link("a", "Ravi Kumar"), link("b", "Asha Rao"), link("c", "Ravi Kumar")], label);
    expect(rows.map((r) => [r.link.linkId, r.position, r.total])).toEqual([
      ["a", 1, 2],
      ["b", 1, 1],
      ["c", 2, 2],
    ]);
  });

  it("keeps every link as its own row — two codes are two grants, revoked separately", () => {
    const rows = groupPatientLinks([link("a", "Ravi Kumar"), link("c", "Ravi Kumar")], label);
    expect(rows).toHaveLength(2);
  });

  it("leaves the ordinary one-link-per-patient case unmarked", () => {
    expect(groupPatientLinks([link("a", "Ravi Kumar")], label).map((r) => r.total)).toEqual([1]);
    expect(groupPatientLinks([], label)).toEqual([]);
  });
});

describe("sectionLabels", () => {
  it("names the sections rather than counting them, so two links read differently", () => {
    expect(sectionLabels(["medications", "allergies"])).toBe("Current medicines, Allergies");
    expect(sectionLabels(["bloodPressureReadings", "encounters"])).toBe("Blood pressure, Visits");
    expect(sectionLabels([])).toBe("");
  });
});
