import { describe, expect, it } from "vitest";
import { addReportValueSchema, parseReportNumericValue } from "./report-value.js";

describe("parseReportNumericValue", () => {
  it("parses plain numbers, trimmed", () => {
    expect(parseReportNumericValue("13.2")).toBe("13.2");
    expect(parseReportNumericValue(" 5.7 ")).toBe("5.7");
    expect(parseReportNumericValue("450000")).toBe("450000");
    expect(parseReportNumericValue("0.005")).toBe("0.005");
  });

  it("strips both Western and Indian digit grouping", () => {
    expect(parseReportNumericValue("13,200")).toBe("13200");
    expect(parseReportNumericValue("450,000")).toBe("450000");
    expect(parseReportNumericValue("4,50,000")).toBe("450000");
  });

  it("refuses a single short comma group — a European decimal comma read as 132 would be a wrong clinical value", () => {
    expect(parseReportNumericValue("13,2")).toBeNull();
  });

  it("leaves qualitative and censored results as text-only", () => {
    for (const v of ["Negative", "Trace", "<5.7", ">100", "13.2-17.0", "5.7%", "28 ng/mL", "1:80"]) {
      expect(parseReportNumericValue(v)).toBeNull();
    }
  });

  it("refuses shapes labs don't print rather than guessing", () => {
    for (const v of [".5", "-1", "+3", "13.", ""]) {
      expect(parseReportNumericValue(v)).toBeNull();
    }
  });

  it("keeps overflow text-only instead of erroring — Decimal(10,3) capacity", () => {
    expect(parseReportNumericValue("12345678")).toBeNull(); // 8 integer digits
    expect(parseReportNumericValue("9999999")).toBe("9999999"); // 7 fits
    expect(parseReportNumericValue("1.2345")).toBeNull(); // 4 significant decimals
    expect(parseReportNumericValue("1.2300")).toBe("1.23"); // trailing zeros trim into capacity
  });
});

describe("addReportValueSchema", () => {
  it("requires otherLabel exactly when analyte is other", () => {
    expect(addReportValueSchema.safeParse({ analyte: "other", enteredValue: "12" }).success).toBe(false);
    expect(
      addReportValueSchema.safeParse({ analyte: "other", otherLabel: "Serum Ferritin", enteredValue: "12" }).success,
    ).toBe(true);
    expect(
      addReportValueSchema.safeParse({ analyte: "hemoglobin", otherLabel: "nope", enteredValue: "13.2" }).success,
    ).toBe(false);
  });

  it("rejects unknown analytes and empty values", () => {
    expect(addReportValueSchema.safeParse({ analyte: "unicorn_dust", enteredValue: "1" }).success).toBe(false);
    expect(addReportValueSchema.safeParse({ analyte: "hemoglobin", enteredValue: "  " }).success).toBe(false);
  });
});
