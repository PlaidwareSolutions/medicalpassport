import { isDueOnDate } from "./recurrence";

describe("isDueOnDate", () => {
  it("is always due for daily recurrence, anchor or not", () => {
    expect(isDueOnDate("daily", null, "2026-07-22")).toBe(true);
    expect(isDueOnDate("daily", "2026-01-01", "2026-07-22")).toBe(true);
  });

  it("is never due for non-daily recurrence with no anchor", () => {
    expect(isDueOnDate("weekly", null, "2026-07-22")).toBe(false);
    expect(isDueOnDate("monthly", null, "2026-07-22")).toBe(false);
  });

  it("is never due before the anchor date", () => {
    expect(isDueOnDate("weekly", "2026-07-22", "2026-07-21")).toBe(false);
    expect(isDueOnDate("monthly", "2026-07-22", "2026-06-22")).toBe(false);
  });

  describe("weekly", () => {
    it("is due on the anchor date and every 7th day after", () => {
      expect(isDueOnDate("weekly", "2026-07-01", "2026-07-01")).toBe(true);
      expect(isDueOnDate("weekly", "2026-07-01", "2026-07-08")).toBe(true);
      expect(isDueOnDate("weekly", "2026-07-01", "2026-07-15")).toBe(true);
    });

    it("is not due on off-cycle days", () => {
      expect(isDueOnDate("weekly", "2026-07-01", "2026-07-02")).toBe(false);
      expect(isDueOnDate("weekly", "2026-07-01", "2026-07-07")).toBe(false);
      expect(isDueOnDate("weekly", "2026-07-01", "2026-07-14")).toBe(false);
    });
  });

  describe("fortnightly", () => {
    it("is due on the anchor date and every 14th day after", () => {
      expect(isDueOnDate("fortnightly", "2026-07-01", "2026-07-01")).toBe(true);
      expect(isDueOnDate("fortnightly", "2026-07-01", "2026-07-15")).toBe(true);
      expect(isDueOnDate("fortnightly", "2026-07-01", "2026-07-29")).toBe(true);
    });

    it("is not due at the 1-week midpoint (that's a weekly cycle point, not fortnightly)", () => {
      expect(isDueOnDate("fortnightly", "2026-07-01", "2026-07-08")).toBe(false);
    });
  });

  describe("monthly", () => {
    it("is due on the same day-of-month in later months", () => {
      expect(isDueOnDate("monthly", "2026-01-15", "2026-01-15")).toBe(true);
      expect(isDueOnDate("monthly", "2026-01-15", "2026-02-15")).toBe(true);
      expect(isDueOnDate("monthly", "2026-01-15", "2026-03-15")).toBe(true);
    });

    it("is not due on other days of the month", () => {
      expect(isDueOnDate("monthly", "2026-01-15", "2026-02-14")).toBe(false);
      expect(isDueOnDate("monthly", "2026-01-15", "2026-02-16")).toBe(false);
    });

    it("clamps a 31st anchor to the last day of shorter months", () => {
      // 2026 is not a leap year — February has 28 days.
      expect(isDueOnDate("monthly", "2026-01-31", "2026-02-28")).toBe(true);
      expect(isDueOnDate("monthly", "2026-01-31", "2026-03-31")).toBe(true);
      // April has 30 days.
      expect(isDueOnDate("monthly", "2026-01-31", "2026-04-30")).toBe(true);
    });

    it("clamps a 31st anchor to the 29th in a leap-year February", () => {
      expect(isDueOnDate("monthly", "2028-01-31", "2028-02-29")).toBe(true);
      expect(isDueOnDate("monthly", "2028-01-31", "2028-02-28")).toBe(false);
    });

    it("clamps a 30th anchor to the 28th in a non-leap February", () => {
      expect(isDueOnDate("monthly", "2026-03-30", "2026-02-28")).toBe(false); // before anchor, never due anyway
      expect(isDueOnDate("monthly", "2026-01-30", "2026-02-28")).toBe(true);
    });
  });
});
