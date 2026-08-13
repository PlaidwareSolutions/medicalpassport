import { describe, expect, it } from "vitest";
import { LEAD_RETENTION_MONTHS, leadRetentionCutoff, isLeadEligibleForDeletion } from "./lead-retention";

const NOW = new Date("2026-08-13T10:00:00.000Z");

/** Adds `months` calendar months (UTC) to a base date, for building fixtures. */
function monthsFromNow(months: number): Date {
  return new Date(Date.UTC(2026, 7 + months, 13, 10, 0, 0));
}

describe("leadRetentionCutoff", () => {
  it("is 24 calendar months before now, in UTC (not 730 days)", () => {
    expect(LEAD_RETENTION_MONTHS).toBe(24);
    expect(leadRetentionCutoff(NOW).toISOString()).toBe("2024-08-13T10:00:00.000Z");
  });

  it("handles year underflow across the boundary", () => {
    const cutoff = leadRetentionCutoff(new Date("2026-01-15T00:00:00.000Z"));
    expect(cutoff.toISOString()).toBe("2024-01-15T00:00:00.000Z");
  });
});

describe("isLeadEligibleForDeletion", () => {
  const cutoff = leadRetentionCutoff(NOW); // 2024-08-13

  it("deletes a 25-month-old untouched lead", () => {
    expect(isLeadEligibleForDeletion(monthsFromNow(-25), cutoff)).toBe(true);
  });

  it("retains a lead just inside the boundary (23 months)", () => {
    expect(isLeadEligibleForDeletion(monthsFromNow(-23), cutoff)).toBe(false);
  });

  it("boundary: exactly 24 months ago is NOT eligible (strictly-older-than)", () => {
    expect(isLeadEligibleForDeletion(monthsFromNow(-24), cutoff)).toBe(false);
  });

  it("boundary: one day past 24 months IS eligible", () => {
    expect(isLeadEligibleForDeletion(new Date("2024-08-12T10:00:00.000Z"), cutoff)).toBe(true);
  });

  it("retains a recent lead", () => {
    expect(isLeadEligibleForDeletion(monthsFromNow(-1), cutoff)).toBe(false);
  });

  it("retains an old lead that had a recent interaction (uses lastInteractionAt, not creation)", () => {
    // createdAt would be 30 months ago, but lastInteractionAt is 2 months ago.
    expect(isLeadEligibleForDeletion(monthsFromNow(-2), cutoff)).toBe(false);
  });

  it("fail-safe: null/undefined lastInteractionAt is never eligible", () => {
    expect(isLeadEligibleForDeletion(null, cutoff)).toBe(false);
    expect(isLeadEligibleForDeletion(undefined, cutoff)).toBe(false);
  });
});
