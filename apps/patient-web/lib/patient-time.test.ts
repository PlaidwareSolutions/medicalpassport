import { describe, expect, it } from "vitest";
import { formatPatientDateTime, formatPatientTime } from "./patient-time";

describe("patient-time formatting", () => {
  const instant = "2026-08-10T02:30:00.000Z"; // 08:00 IST, 21:30 (Aug 9) Chicago

  it("renders the instant on the patient's wall clock, not the machine's", () => {
    expect(formatPatientTime(instant, "Asia/Kolkata")).toMatch(/8:00/);
    expect(formatPatientTime(instant, "America/Chicago")).toMatch(/9:30/);
  });

  it("date-time formatting carries the zone's own calendar date", () => {
    expect(formatPatientDateTime(instant, "Asia/Kolkata")).toContain("10");
    expect(formatPatientDateTime(instant, "America/Chicago")).toContain("9");
  });
});
