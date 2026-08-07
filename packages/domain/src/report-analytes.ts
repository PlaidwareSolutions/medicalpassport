/**
 * The closed vocabulary for structured lab values on test reports
 * (docs/07 screen 44, docs/13 `report_values`).
 *
 * PROVISIONAL PENDING CLINICAL VALIDATION (docs/34): labels and canonical
 * units were chosen to match what common Indian lab reports actually print,
 * but need clinical-lead sign-off before the list is authoritative. Named
 * review items: T3 is printed in both ng/mL and ng/dL by Indian labs;
 * platelets appear both as absolute `/cumm` and as "lakhs/cumm"; urea vs
 * BUN. Renaming later is safe by design — the DB column is TEXT, not an
 * enum, so a rename is one edit here plus one UPDATE.
 *
 * Labels are deliberately English-only domain constants, NOT localization
 * keys: the patient is transcribing off a report printed in English, and
 * the picker must say exactly what the paper says. (Indian reports print
 * "LIPID PROFILE", "TSH" — a translated label would make matching harder
 * for precisely the low-literacy user it would claim to help.) UI chrome
 * around the picker is localized as usual.
 *
 * `other` is the only open entry: it requires a free-text label and never
 * participates in per-analyte history (no shared identity to trend).
 */

export const REPORT_ANALYTE_GROUPS = [
  "cbc",
  "diabetes",
  "lipids",
  "liver",
  "kidney",
  "thyroid",
  "vitamins",
  "electrolytes",
  "inflammation",
  "other",
] as const;
export type ReportAnalyteGroup = (typeof REPORT_ANALYTE_GROUPS)[number];

/** Group headings as printed on Indian reports — same match-the-paper rationale as the labels. */
export const REPORT_ANALYTE_GROUP_LABELS: Record<ReportAnalyteGroup, string> = {
  cbc: "Blood counts (CBC)",
  diabetes: "Blood sugar",
  lipids: "Lipid profile",
  liver: "Liver function (LFT)",
  kidney: "Kidney function (KFT)",
  thyroid: "Thyroid profile",
  vitamins: "Vitamins",
  electrolytes: "Electrolytes",
  inflammation: "Inflammation markers",
  other: "Other",
};

export interface ReportAnalyte {
  id: string;
  /** English, exactly as printed on Indian lab reports — see the header comment. */
  label: string;
  /** Canonical unit as commonly printed; null only for `other`. */
  unit: string | null;
  group: ReportAnalyteGroup;
}

export const REPORT_ANALYTES: readonly ReportAnalyte[] = [
  { id: "hemoglobin", label: "Hemoglobin (Hb)", unit: "g/dL", group: "cbc" },
  { id: "rbc_count", label: "RBC Count", unit: "million/µL", group: "cbc" },
  { id: "wbc_total", label: "Total WBC Count (TLC)", unit: "/µL", group: "cbc" },
  { id: "platelet_count", label: "Platelet Count", unit: "/µL", group: "cbc" },
  { id: "hematocrit", label: "Hematocrit (PCV)", unit: "%", group: "cbc" },
  { id: "fasting_glucose", label: "Fasting Blood Sugar (FBS)", unit: "mg/dL", group: "diabetes" },
  { id: "post_prandial_glucose", label: "Post Prandial Blood Sugar (PPBS)", unit: "mg/dL", group: "diabetes" },
  { id: "hba1c", label: "HbA1c", unit: "%", group: "diabetes" },
  { id: "total_cholesterol", label: "Total Cholesterol", unit: "mg/dL", group: "lipids" },
  { id: "ldl_cholesterol", label: "LDL Cholesterol", unit: "mg/dL", group: "lipids" },
  { id: "hdl_cholesterol", label: "HDL Cholesterol", unit: "mg/dL", group: "lipids" },
  { id: "triglycerides", label: "Triglycerides", unit: "mg/dL", group: "lipids" },
  { id: "bilirubin_total", label: "Total Bilirubin", unit: "mg/dL", group: "liver" },
  { id: "sgpt_alt", label: "SGPT (ALT)", unit: "U/L", group: "liver" },
  { id: "sgot_ast", label: "SGOT (AST)", unit: "U/L", group: "liver" },
  { id: "alkaline_phosphatase", label: "Alkaline Phosphatase (ALP)", unit: "U/L", group: "liver" },
  { id: "total_protein", label: "Total Protein", unit: "g/dL", group: "liver" },
  { id: "albumin", label: "Albumin", unit: "g/dL", group: "liver" },
  { id: "creatinine", label: "Serum Creatinine", unit: "mg/dL", group: "kidney" },
  { id: "urea", label: "Blood Urea", unit: "mg/dL", group: "kidney" },
  { id: "uric_acid", label: "Uric Acid", unit: "mg/dL", group: "kidney" },
  { id: "tsh", label: "TSH", unit: "µIU/mL", group: "thyroid" },
  { id: "t3_total", label: "T3 (Total)", unit: "ng/dL", group: "thyroid" },
  { id: "t4_total", label: "T4 (Total)", unit: "µg/dL", group: "thyroid" },
  { id: "vitamin_d", label: "Vitamin D (25-OH)", unit: "ng/mL", group: "vitamins" },
  { id: "vitamin_b12", label: "Vitamin B12", unit: "pg/mL", group: "vitamins" },
  { id: "sodium", label: "Sodium (Na+)", unit: "mEq/L", group: "electrolytes" },
  { id: "potassium", label: "Potassium (K+)", unit: "mEq/L", group: "electrolytes" },
  { id: "crp", label: "CRP", unit: "mg/L", group: "inflammation" },
  { id: "esr", label: "ESR", unit: "mm/hr", group: "inflammation" },
  { id: "other", label: "Other test value", unit: null, group: "other" },
] as const;

export const REPORT_ANALYTE_IDS = REPORT_ANALYTES.map((a) => a.id) as [string, ...string[]];

export function reportAnalyteById(id: string): ReportAnalyte | undefined {
  return REPORT_ANALYTES.find((a) => a.id === id);
}
