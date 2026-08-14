import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  dateStringInTz,
  isValidTimeZone,
  minutesSinceMidnightInTz,
  tzOffsetMinutes,
  zonedTimeToInstant,
} from "./timezone.js";

describe("timezone helpers", () => {
  it("validates IANA zone names", () => {
    expect(isValidTimeZone("Asia/Kolkata")).toBe(true);
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("IST is always +330 (no DST)", () => {
    expect(tzOffsetMinutes("Asia/Kolkata", new Date("2026-01-10T12:00:00Z"))).toBe(330);
    expect(tzOffsetMinutes("Asia/Kolkata", new Date("2026-07-10T12:00:00Z"))).toBe(330);
  });

  it("Chicago crosses DST: -360 in winter, -300 in summer", () => {
    expect(tzOffsetMinutes("America/Chicago", new Date("2026-01-10T12:00:00Z"))).toBe(-360);
    expect(tzOffsetMinutes("America/Chicago", new Date("2026-07-10T12:00:00Z"))).toBe(-300);
  });

  it("resolves a wall time to the correct instant in each zone", () => {
    expect(zonedTimeToInstant("Asia/Kolkata", "2026-08-10", "08:00").toISOString()).toBe("2026-08-10T02:30:00.000Z");
    expect(zonedTimeToInstant("America/Chicago", "2026-08-10", "08:00").toISOString()).toBe("2026-08-10T13:00:00.000Z");
    expect(zonedTimeToInstant("America/Chicago", "2026-01-10", "08:00").toISOString()).toBe("2026-01-10T14:00:00.000Z");
  });

  it("spring-forward gap resolves deterministically (one wall hour early), never crashes", () => {
    // 2026-03-08 02:30 does not exist in Chicago (clocks jump 02:00→03:00);
    // the resolver lands on 01:30 CST — early, never late, for a reminder.
    expect(zonedTimeToInstant("America/Chicago", "2026-03-08", "02:30").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("computes the calendar date as seen in the zone", () => {
    const at = new Date("2026-08-09T20:00:00Z");
    expect(dateStringInTz("Asia/Kolkata", at)).toBe("2026-08-10");
    expect(dateStringInTz("America/Chicago", at)).toBe("2026-08-09");
  });

  it("computes minutes since local midnight", () => {
    const at = new Date("2026-08-10T02:30:00Z"); // 08:00 IST, 21:30 previous day Chicago
    expect(minutesSinceMidnightInTz("Asia/Kolkata", at)).toBe(8 * 60);
    expect(minutesSinceMidnightInTz("America/Chicago", at)).toBe(21 * 60 + 30);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysToDateString("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDaysToDateString("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });
});
