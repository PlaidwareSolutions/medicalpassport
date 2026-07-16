import { describe, expect, it } from "vitest";
import { parsePattern, proposeSlots } from "./frequency.js";

describe("parsePattern", () => {
  it("parses 1-0-1", () => {
    expect(parsePattern("1-0-1")).toEqual([
      { slot: "morning", quantity: 1 },
      { slot: "night", quantity: 1 },
    ]);
  });

  it("parses half-tablet doses", () => {
    expect(parsePattern("0.5-0-0.5")).toEqual([
      { slot: "morning", quantity: 0.5 },
      { slot: "night", quantity: 0.5 },
    ]);
  });

  it("rejects malformed and all-zero patterns instead of guessing", () => {
    expect(parsePattern("1-0")).toBeNull();
    expect(parsePattern("0-0-0")).toBeNull();
    expect(parsePattern("once daily")).toBeNull();
  });
});

describe("proposeSlots", () => {
  it("maps OD/BD/TDS/HS", () => {
    expect(proposeSlots("OD")).toHaveLength(1);
    expect(proposeSlots("BD")).toHaveLength(2);
    expect(proposeSlots("TDS")).toHaveLength(3);
    expect(proposeSlots("HS")).toEqual([{ slot: "night", quantity: 1 }]);
  });

  it("returns null for ambiguous codes that need explicit patient setup", () => {
    expect(proposeSlots("SOS")).toBeNull();
    expect(proposeSlots("QID")).toBeNull();
    expect(proposeSlots("ALTERNATE_DAY")).toBeNull();
  });
});
