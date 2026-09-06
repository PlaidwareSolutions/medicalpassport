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

describe("patient-local entry (visits, docs/16)", () => {
  it("interprets a datetime-local value in the patient's zone, not the device's", async () => {
    const { isoToPatientLocal, patientLocalToIso, patientTodayKey } = await import("./patient-time");
    // 21:05 in Hyderabad is 15:35 UTC regardless of where the caregiver sits.
    expect(patientLocalToIso("2026-09-06T21:05", "Asia/Kolkata")).toBe("2026-09-06T15:35:00.000Z");
    expect(patientLocalToIso("2026-09-06T21:05", "America/Chicago")).toBe("2026-09-07T02:05:00.000Z");
    // Round-trips back to the same wall clock.
    expect(isoToPatientLocal("2026-09-06T15:35:00.000Z", "Asia/Kolkata")).toBe("2026-09-06T21:05");
    // The patient's "today" follows their zone: 19:35Z is already the 7th in Hyderabad.
    expect(patientTodayKey("Asia/Kolkata", new Date("2026-09-06T19:35:00.000Z"))).toBe("2026-09-07");
    expect(patientTodayKey("America/Chicago", new Date("2026-09-06T19:35:00.000Z"))).toBe("2026-09-06");
  });
});
