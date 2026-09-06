import { describe, expect, it } from "vitest";
import { normalizeDigits, parseVoiceObservation, recognitionLanguage, wordsToDigits } from "./parse-observation";

describe("parseVoiceObservation", () => {
  it("reads a blood pressure with 'over'", () => {
    const c = parseVoiceObservation("blood pressure 128 over 76", "en");
    expect(c.concept).toBe("blood_pressure");
    expect(c.value).toBe("128");
    expect(c.value2).toBe("76");
    expect(c.pulse).toBeUndefined();
  });

  it("reads two bare numbers as a blood pressure when the sheet already knows the concept", () => {
    const c = parseVoiceObservation("128 76", "en", "blood_pressure");
    expect(c.value).toBe("128");
    expect(c.value2).toBe("76");
  });

  it("takes a third number as the pulse", () => {
    const c = parseVoiceObservation("bp 130 by 80 pulse 72", "en");
    expect(c).toMatchObject({ concept: "blood_pressure", value: "130", value2: "80", pulse: "72" });
  });

  it("leaves a lone blood pressure number for the patient instead of guessing", () => {
    const c = parseVoiceObservation("blood pressure 128", "en");
    expect(c.value).toBe("128");
    expect(c.value2).toBeUndefined();
  });

  it("reads sugar with a unit word", () => {
    const c = parseVoiceObservation("sugar 140 milligrams", "en");
    expect(c).toMatchObject({ concept: "blood_glucose", value: "140", unit: "mg/dL" });
  });

  it("reads a decimal weight", () => {
    const c = parseVoiceObservation("weight 72.5 kilos", "en");
    expect(c).toMatchObject({ concept: "body_weight", value: "72.5", unit: "kg" });
  });

  it("reads a temperature in fahrenheit", () => {
    expect(parseVoiceObservation("temperature 101 fahrenheit", "en")).toMatchObject({ concept: "body_temperature", value: "101", unit: "degF" });
  });

  it("spelled-out numbers work", () => {
    expect(parseVoiceObservation("blood pressure one twenty eight over seventy six", "en")).toMatchObject({ value: "128", value2: "76" });
  });

  it("drops a pain score outside 0–10", () => {
    expect(parseVoiceObservation("pain 7", "en").value).toBe("7");
    expect(parseVoiceObservation("pain 70", "en").value).toBeUndefined();
  });

  it("returns no concept and no value for unrelated speech", () => {
    const c = parseVoiceObservation("call my daughter tomorrow", "en");
    expect(c.concept).toBeUndefined();
    expect(c.value).toBeUndefined();
  });

  it("does not invent a value when the sentence has no number", () => {
    expect(parseVoiceObservation("my blood pressure", "en").value).toBeUndefined();
  });

  it("understands Hindi, including Devanagari digits", () => {
    const c = parseVoiceObservation("बीपी १२८ बटा ७६", "hi");
    expect(c).toMatchObject({ concept: "blood_pressure", value: "128", value2: "76" });
    expect(parseVoiceObservation("शुगर 140", "hi")).toMatchObject({ concept: "blood_glucose", value: "140" });
  });

  it("understands Telugu", () => {
    expect(parseVoiceObservation("బరువు 68 కిలో", "te")).toMatchObject({ concept: "body_weight", value: "68", unit: "kg" });
  });

  it("understands Urdu, including Arabic-Indic digits", () => {
    expect(parseVoiceObservation("شوگر ۱۵۰", "ur")).toMatchObject({ concept: "blood_glucose", value: "150" });
  });

  it("prefers the longer concept phrase", () => {
    expect(parseVoiceObservation("heart rate 88", "en").concept).toBe("heart_rate");
    expect(parseVoiceObservation("pressure 120 80", "en").concept).toBe("blood_pressure");
  });
});

describe("helpers", () => {
  it("normalizes Indic digits", () => {
    expect(normalizeDigits("१२८/७६ ౯౦ ۴۵")).toBe("128/76 90 45");
  });

  it("turns number words into digits", () => {
    expect(wordsToDigits("one twenty eight over seventy six")).toBe("128 over 76");
    expect(wordsToDigits("ninety nine")).toBe("99");
    expect(wordsToDigits("one hundred and five")).toBe("100 and 5");
  });

  it("maps locales to recognizer languages", () => {
    expect(recognitionLanguage("hi")).toBe("hi-IN");
    expect(recognitionLanguage("xx")).toBe("en-IN");
  });
});
