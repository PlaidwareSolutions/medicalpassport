import type { VisitSummaryDto } from "./visit-summary.service";

/**
 * Presentation helpers shared by the WhatsApp text export and (by
 * duplication, see below) the PDF renderer. Kept out of the renderers
 * themselves so the two can't drift on what a check-up metric is called or
 * which ones are shown — the one real risk when the same clinical data is
 * formatted twice.
 *
 * English only, matching the existing text/PDF exports (docs/16 wording
 * rules apply to the patient-facing app; these exports are handed to a
 * clinician by the patient themselves).
 */

const CONTEXT_LABELS: Record<string, string> = {
  before_breakfast: "Before breakfast",
  after_breakfast: "After breakfast",
  before_lunch: "Before lunch",
  after_lunch: "After lunch",
  before_dinner: "Before dinner",
  after_dinner: "After dinner",
  during_night: "During the night",
  random: "Random",
};

export function contextLabel(context: string): string {
  return CONTEXT_LABELS[context] ?? context.replace(/_/g, " ");
}

const REPORT_KIND_LABELS: Record<string, string> = {
  blood_test: "Blood test",
  urine_test: "Urine test",
  imaging: "Imaging / scan",
  ecg: "ECG / heart test",
  pathology: "Pathology / biopsy",
  discharge_summary: "Discharge summary",
  other: "Other test",
};

export function reportKindLabel(kind: string): string {
  return REPORT_KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

type Checkup = NonNullable<VisitSummaryDto["checkups"]>[number];

/**
 * The measured metrics only. A null metric is one the doctor didn't record
 * that visit, so it's omitted entirely rather than rendered as 0 or "—":
 * a fabricated-looking zero on a clinical summary is worse than a gap.
 */
export function checkupMetrics(c: Checkup): string[] {
  const out: string[] = [];
  if (c.fastingGlucoseMgDl != null) out.push(`Fasting glucose: ${c.fastingGlucoseMgDl} mg/dL`);
  if (c.postPrandialGlucoseMgDl != null) out.push(`Post-meal glucose: ${c.postPrandialGlucoseMgDl} mg/dL`);
  if (c.hba1cPercent != null) out.push(`HbA1c: ${c.hba1cPercent}%`);
  if (c.bloodPressureSystolic != null && c.bloodPressureDiastolic != null) {
    out.push(`Blood pressure: ${c.bloodPressureSystolic}/${c.bloodPressureDiastolic}`);
  }
  if (c.weightKg != null) out.push(`Weight: ${c.weightKg} kg`);
  if (c.waistCircumferenceCm != null) out.push(`Waist: ${c.waistCircumferenceCm} cm`);
  if (c.cholesterolMgDl != null) out.push(`Cholesterol: ${c.cholesterolMgDl} mg/dL`);
  return out;
}

/** Date-only values (`YYYY-MM-DD`) must not go through a timezone-shifting Date parse. */
export function formatDateOnly(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", { dateStyle: "medium" });
}
