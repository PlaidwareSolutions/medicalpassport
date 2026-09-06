import { describe, expect, it } from "vitest";
import { channelAllowed, controlFor, digestCutoff, digestDecision, caregiverScopesFor, readChannelFrequency } from "./notification-policy";

/**
 * The per-kind control (docs_v2/04 §12) as the dispatcher reads it. Pure —
 * no database. The H-48 rule is the one that matters most: whatever the
 * stored JSON says, a dose reminder or a missed-dose escalation is never
 * turned down by it.
 */
describe("controlFor", () => {
  const json = {
    new_prescription: { channels: ["web_push"], frequency: "daily_digest" },
    refill: { channels: [], frequency: "off" },
    dose_reminder: { channels: [], frequency: "off" },
    caregiver_escalation: { channels: ["sms"], frequency: "daily_digest" },
  };

  it("returns the stored control for an ordinary kind", () => {
    const c = controlFor(json, "new_prescription");
    expect(c.frequency).toBe("daily_digest");
    expect(c.protected).toBe(false);
    expect(channelAllowed(c, "web_push")).toBe(true);
    expect(channelAllowed(c, "sms")).toBe(false);
  });

  it("an empty channel list allows nothing", () => {
    const c = controlFor(json, "refill");
    expect(c.frequency).toBe("off");
    expect(channelAllowed(c, "web_push")).toBe(false);
    expect(channelAllowed(c, "sms")).toBe(false);
  });

  it("defaults to immediate on every channel when no control is set", () => {
    const c = controlFor(json, "new_test_result");
    expect(c).toEqual({ channels: null, frequency: "immediate", protected: false });
    expect(channelAllowed(c, "sms")).toBe(true);
  });

  it("H-48: dose_reminder and caregiver_escalation ignore the control even when a row was written by hand", () => {
    for (const kind of ["dose_reminder", "caregiver_escalation"]) {
      const c = controlFor(json, kind);
      expect(c).toEqual({ channels: null, frequency: "immediate", protected: true });
      expect(channelAllowed(c, "web_push")).toBe(true);
      expect(channelAllowed(c, "sms")).toBe(true);
    }
  });

  it("tolerates malformed JSON as 'no control'", () => {
    expect(readChannelFrequency(null)).toEqual({});
    expect(readChannelFrequency("nope")).toEqual({});
    expect(readChannelFrequency([1, 2])).toEqual({});
    expect(readChannelFrequency({ refill: "off" })).toEqual({});
    expect(readChannelFrequency({ refill: { channels: ["sms", "pigeon"], frequency: "weekly" } })).toEqual({
      refill: { channels: ["sms"], frequency: "immediate" },
    });
  });
});

describe("daily digest timing", () => {
  const tz = "Asia/Kolkata"; // +05:30, no DST

  it("the cutoff is 08:00 local on the current local day", () => {
    // 2026-09-06 10:15 IST = 04:45Z
    const now = new Date("2026-09-06T04:45:00.000Z");
    expect(digestCutoff(tz, now).toISOString()).toBe("2026-09-06T02:30:00.000Z");
    // 2026-09-06 01:00 IST (19:30Z the previous UTC day) is still 6 Sept locally.
    const early = new Date("2026-09-05T19:30:00.000Z");
    expect(digestCutoff(tz, early).toISOString()).toBe("2026-09-06T02:30:00.000Z");
  });

  it("waits before the cutoff, sends after it for rows created before it, and holds later arrivals for tomorrow", () => {
    const created = new Date("2026-09-05T20:00:00.000Z"); // 01:30 IST
    expect(digestDecision(created, tz, new Date("2026-09-06T01:00:00.000Z"))).toBe("wait"); // 06:30 IST
    expect(digestDecision(created, tz, new Date("2026-09-06T02:31:00.000Z"))).toBe("send"); // 08:01 IST
    const late = new Date("2026-09-06T04:30:00.000Z"); // 10:00 IST
    expect(digestDecision(late, tz, new Date("2026-09-06T04:31:00.000Z"))).toBe("wait"); // 10:01 IST: tomorrow's digest
    expect(digestDecision(late, tz, new Date("2026-09-07T02:31:00.000Z"))).toBe("send"); // next morning
  });
});

describe("caregiverScopesFor", () => {
  it("derives recipients from the authorization matrix rather than a private copy", () => {
    expect(caregiverScopesFor("new_prescription")).toEqual(expect.arrayContaining(["view_medications", "full_management"]));
    expect(caregiverScopesFor("refill_low")).toEqual(expect.arrayContaining(["view_medications", "full_management"]));
    expect(caregiverScopesFor("new_test_result")).toEqual(expect.arrayContaining(["view_tests", "view_medications", "full_management"]));
    // A scope that grants nothing about medicines must not receive medicine news.
    expect(caregiverScopesFor("new_prescription")).not.toContain("record_doses");
    expect(caregiverScopesFor("new_test_result")).not.toContain("upload_documents");
  });
});
