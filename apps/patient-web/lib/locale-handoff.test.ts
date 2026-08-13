import { describe, expect, it } from "vitest";
import { pickInitialLocale, readLangParam } from "./locale-handoff";

describe("pickInitialLocale — precedence + allowlist", () => {
  it("initializes a fresh user (no stored pref) from a valid ?lang and persists it", () => {
    for (const l of ["hi", "te", "ur", "en"] as const) {
      expect(pickInitialLocale({ stored: null, langParam: l })).toEqual({ locale: l, persist: true });
    }
  });

  it("an explicit stored preference ALWAYS wins over ?lang (no overwrite, no persist)", () => {
    expect(pickInitialLocale({ stored: "en", langParam: "te" })).toEqual({ locale: "en", persist: false });
    expect(pickInitialLocale({ stored: "hi", langParam: "te" })).toEqual({ locale: "hi", persist: false });
  });

  it("ignores invalid/malicious ?lang safely (no throw, no persist, default en)", () => {
    for (const bad of ["fr", "../../x", "e", "EN", "", "x".repeat(5000), "hi;te"]) {
      expect(pickInitialLocale({ stored: null, langParam: bad })).toEqual({ locale: "en", persist: false });
    }
  });

  it("no stored pref and no lang → English default", () => {
    expect(pickInitialLocale({ stored: null, langParam: null })).toEqual({ locale: "en", persist: false });
    expect(pickInitialLocale({ stored: undefined, langParam: undefined })).toEqual({ locale: "en", persist: false });
  });

  it("an invalid stored value falls through to the ?lang hint", () => {
    expect(pickInitialLocale({ stored: "garbage", langParam: "ur" })).toEqual({ locale: "ur", persist: true });
  });
});

describe("readLangParam", () => {
  it("extracts lang, leaving src attribution independent", () => {
    expect(readLangParam("?src=website&lang=te")).toBe("te");
    expect(readLangParam("?lang=hi")).toBe("hi");
  });

  it("returns null when absent", () => {
    expect(readLangParam("?src=website")).toBe(null);
    expect(readLangParam("")).toBe(null);
  });
});
