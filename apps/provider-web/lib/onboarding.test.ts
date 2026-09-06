import { describe, expect, it } from "vitest";
import { extractOnboardingToken } from "./onboarding";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab";

describe("extractOnboardingToken", () => {
  it("takes a raw token, trimming whitespace", () => {
    expect(extractOnboardingToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  });

  it("unwraps a deep link in either form", () => {
    expect(extractOnboardingToken(`https://app.medicinepassport.app/onboard?token=${TOKEN}`)).toBe(TOKEN);
    expect(extractOnboardingToken(`https://app.medicinepassport.app/onboard/${TOKEN}`)).toBe(TOKEN);
  });

  it("refuses what the API would refuse", () => {
    expect(extractOnboardingToken("")).toBeUndefined();
    expect(extractOnboardingToken("short")).toBeUndefined();
    expect(extractOnboardingToken("has a space inside it which is long enough")).toBeUndefined();
    expect(extractOnboardingToken("x".repeat(201))).toBeUndefined();
  });
});
