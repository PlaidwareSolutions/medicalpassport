import { z } from "zod";
import { REPORT_ANALYTE_IDS } from "@medpass/domain";

/**
 * Structured lab values transcribed off a test report (docs/07 screen 44).
 *
 * `enteredValue` is the immutable original, exactly as the patient typed it
 * off the paper (docs/13: original vs normalized always separate). The
 * parsed numeric twin is derived server-side by `parseReportNumericValue`
 * and exists only to answer "does this row trend" — nothing ever renders
 * it, so a parse bug can never change what a doctor sees.
 */
export const addReportValueSchema = z
  .object({
    analyte: z.enum(REPORT_ANALYTE_IDS),
    /** Names the measurement when analyte is `other` ("Serum Ferritin"). */
    otherLabel: z.string().trim().min(1).max(80).optional(),
    /** Exactly as printed — numeric or qualitative ("Negative", "<5.7"). */
    enteredValue: z.string().trim().min(1).max(40),
    /** The report's own printed reference range — display-only, never compared (docs/02). */
    referenceText: z.string().trim().max(120).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.analyte === "other" && !v.otherLabel) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["otherLabel"], message: "Name the test this value is for" });
    }
    if (v.analyte !== "other" && v.otherLabel) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["otherLabel"], message: "Only 'other' values take a custom name" });
    }
  });
export type AddReportValueInput = z.infer<typeof addReportValueSchema>;

/** `other` is excluded: free-labelled values share no identity to trend. */
export const reportValueHistoryQuerySchema = z.object({
  analyte: z.enum(REPORT_ANALYTE_IDS.filter((id) => id !== "other") as [string, ...string[]]),
});

/** Decimal(10,3) capacity — anything past it stays text-only rather than erroring. */
const MAX_INTEGER_DIGITS = 7;
const MAX_FRACTION_DIGITS = 3;

const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
// 2-or-3-digit groups accept both Indian "4,50,000" and Western "450,000".
// A single short group ("13,2") deliberately fails: that's most likely a
// European decimal comma, and reading it as 132 would be a wrong clinical
// value — it stays text-only instead.
const GROUPED_NUMBER = /^\d{1,3}(,\d{2,3})+(\.\d+)?$/;

/**
 * Parses the typed value into a clean decimal string for storage, or null
 * when the entry is qualitative/censored/ambiguous ("Negative", "<5.7",
 * "13.2-17.0", "5.7%") — those rows simply never trend.
 */
export function parseReportNumericValue(entered: string): string | null {
  const value = entered.trim();
  let digits: string;
  if (PLAIN_NUMBER.test(value)) digits = value;
  else if (GROUPED_NUMBER.test(value)) digits = value.replace(/,/g, "");
  else return null;

  const [whole, fraction = ""] = digits.split(".");
  if (whole!.length > MAX_INTEGER_DIGITS) return null;
  const trimmedFraction = fraction.replace(/0+$/, "");
  if (trimmedFraction.length > MAX_FRACTION_DIGITS) return null;
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole!;
}
