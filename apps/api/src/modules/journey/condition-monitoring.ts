import type { ObservationConcept } from "@medpass/domain";

/**
 * "Which tests and measurements are usually used to follow this condition."
 *
 * Classification (docs_v2/10 §1): **Information**, and the weakest possible
 * use of it. Nothing here is a recommendation and nothing here is a fact
 * about the patient. A hit only ever produces a `suggested`
 * `ClinicalRelationship` — a question the patient answers — and only when
 * the patient *already has* rows of that kind: this table never says "you
 * should get an HbA1c", it says "you have HbA1c results on file; are they
 * for your diabetes?".
 *
 * Matching is on the condition's own entered text, lower-cased, plus the
 * ICD-10 chapter prefix when the row happens to carry a code. Entries are
 * deliberately few and uncontroversial; adding one is a Safety Board change
 * like any other clinical content, because a wrong suggestion costs the
 * patient a wrong answer to a question they were asked in good faith.
 */
export interface MonitoringHint {
  /** @medpass/terminology analyte keys. */
  readonly analyteKeys: readonly string[];
  readonly concepts: readonly ObservationConcept[];
}

interface Entry extends MonitoringHint {
  /** Lower-case substrings of the condition label. */
  readonly keywords: readonly string[];
  /** ICD-10 code prefixes, matched case-insensitively when a code is present. */
  readonly icd10Prefixes?: readonly string[];
}

const TABLE: readonly Entry[] = [
  {
    keywords: ["diabetes", "diabetic", "t2dm", "t1dm", "madhumeh", "मधुमेह", "sugar problem", "blood sugar"],
    icd10Prefixes: ["E10", "E11", "E12", "E13", "E14"],
    analyteKeys: ["hba1c", "fasting_glucose", "post_prandial_glucose"],
    concepts: ["blood_glucose", "body_weight"],
  },
  {
    keywords: ["hypertension", "high blood pressure", "high bp", "raised bp", "उच्च रक्तचाप"],
    icd10Prefixes: ["I10", "I11", "I12", "I13", "I15"],
    analyteKeys: ["creatinine"],
    concepts: ["blood_pressure", "body_weight"],
  },
  {
    keywords: ["hypothyroid", "hyperthyroid", "thyroid", "थायराइड"],
    icd10Prefixes: ["E02", "E03", "E05"],
    analyteKeys: ["tsh", "t3_total", "t4_total"],
    concepts: ["body_weight"],
  },
  {
    keywords: ["cholesterol", "dyslipid", "hyperlipid", "lipid"],
    icd10Prefixes: ["E78"],
    analyteKeys: ["total_cholesterol", "ldl_cholesterol", "hdl_cholesterol", "triglycerides"],
    concepts: ["body_weight"],
  },
  {
    keywords: ["anaemia", "anemia", "खून की कमी"],
    icd10Prefixes: ["D50", "D51", "D52", "D53", "D64"],
    analyteKeys: ["hemoglobin", "vitamin_b12"],
    concepts: [],
  },
  {
    keywords: ["kidney", "renal", "ckd", "nephro", "गुर्दा"],
    icd10Prefixes: ["N17", "N18", "N19"],
    analyteKeys: ["creatinine", "urea"],
    concepts: ["blood_pressure"],
  },
  {
    keywords: ["liver", "hepatitis", "fatty liver", "cirrhosis"],
    icd10Prefixes: ["K70", "K71", "K72", "K73", "K74", "K75", "K76"],
    analyteKeys: ["sgpt_alt", "sgot_ast", "bilirubin_total"],
    concepts: [],
  },
  {
    keywords: ["gout", "uric acid"],
    icd10Prefixes: ["M10"],
    analyteKeys: ["uric_acid"],
    concepts: [],
  },
  {
    keywords: ["asthma", "copd", "bronchitis", "दमा"],
    icd10Prefixes: ["J44", "J45"],
    analyteKeys: [],
    concepts: ["peak_flow", "spo2"],
  },
  {
    keywords: ["obesity", "overweight", "मोटापा"],
    icd10Prefixes: ["E66"],
    analyteKeys: [],
    concepts: ["body_weight", "bmi", "waist_circumference"],
  },
  {
    keywords: ["vitamin d"],
    icd10Prefixes: ["E55"],
    analyteKeys: ["vitamin_d"],
    concepts: [],
  },
  {
    keywords: ["b12", "b-12"],
    analyteKeys: ["vitamin_b12"],
    concepts: [],
  },
  {
    keywords: ["atrial fibrillation", "afib", "a-fib", "anticoagul"],
    icd10Prefixes: ["I48"],
    analyteKeys: [],
    concepts: ["heart_rate", "inr"],
  },
];

const EMPTY: MonitoringHint = { analyteKeys: [], concepts: [] };

/**
 * The union of every matching entry. A label like "Type 2 diabetes with
 * hypertension" legitimately matches two rows, and answering two questions
 * is better than silently picking one.
 */
export function usualMonitoringFor(label: string, code?: string | null): MonitoringHint {
  const text = label.toLowerCase();
  const upperCode = code?.trim().toUpperCase() ?? "";
  const analyteKeys = new Set<string>();
  const concepts = new Set<ObservationConcept>();
  let hit = false;
  for (const entry of TABLE) {
    const byText = entry.keywords.some((k) => text.includes(k));
    const byCode = upperCode !== "" && (entry.icd10Prefixes ?? []).some((p) => upperCode.startsWith(p));
    if (!byText && !byCode) continue;
    hit = true;
    for (const a of entry.analyteKeys) analyteKeys.add(a);
    for (const c of entry.concepts) concepts.add(c);
  }
  return hit ? { analyteKeys: [...analyteKeys], concepts: [...concepts] } : EMPTY;
}
