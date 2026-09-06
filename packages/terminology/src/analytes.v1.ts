/**
 * `analytes.v1` — LOINC / UCUM mapping for the V1 closed analyte vocabulary
 * (docs_v2/08 §3, docs_v2/04 §6.3). One entry per key in
 * `packages/domain/src/report-analytes.ts`; a test enforces the 1:1 match.
 *
 * Status: PROVISIONAL PENDING GATE 1b CLINICAL REVIEW (docs/34). Rules used
 * while filling this table:
 *
 *  - `loincCode` is set only where the author is confident of the code and
 *    of its match to what Indian labs print under that label. Anything less
 *    is `null` with a `reviewNote` naming the candidate codes, and shows up
 *    in `listUnmapped()` for the reviewer.
 *  - `canonicalUnit` is the UCUM code; `canonicalUnitDisplay` is the unit as
 *    printed on the paper and MUST equal the V1 `unit` in `report-analytes.ts`
 *    (tested), because the picker must say exactly what the report says.
 *  - `allowedEnteredUnits` lists the other units the same analyte is printed
 *    in, with `canonical = entered * factor + offset`. Factors are the
 *    standard molar/mass conversions; they are NOT clinical thresholds.
 *  - `gate1bReview: true` marks the three items docs/34 explicitly flags
 *    (T3 ng/mL vs ng/dL, platelets absolute vs lakhs, urea vs BUN).
 *
 * Renaming or re-coding later is cheap by design: the DB stores the key as
 * TEXT and the LOINC code is filled by this layer, never by the client.
 */

import type { UnitConversion } from "./types.js";

export const ANALYTE_KEYS_V1 = [
  "hemoglobin",
  "rbc_count",
  "wbc_total",
  "platelet_count",
  "hematocrit",
  "fasting_glucose",
  "post_prandial_glucose",
  "hba1c",
  "total_cholesterol",
  "ldl_cholesterol",
  "hdl_cholesterol",
  "triglycerides",
  "bilirubin_total",
  "sgpt_alt",
  "sgot_ast",
  "alkaline_phosphatase",
  "total_protein",
  "albumin",
  "creatinine",
  "urea",
  "uric_acid",
  "tsh",
  "t3_total",
  "t4_total",
  "vitamin_d",
  "vitamin_b12",
  "sodium",
  "potassium",
  "crp",
  "esr",
  "other",
] as const;
export type AnalyteKey = (typeof ANALYTE_KEYS_V1)[number];

export interface AnalyteEntry {
  readonly key: AnalyteKey;
  /** English label exactly as printed on Indian reports (mirrors the V1 vocabulary). */
  readonly display: string;
  /** V1 group key (`cbc`, `lipids`, …) kept for picker grouping. */
  readonly group: string;
  /** LOINC code, or null when unmapped / uncertain (see `reviewNote`). */
  readonly loincCode: string | null;
  /** LOINC long common name for the chosen code; null when unmapped. */
  readonly loincDisplay: string | null;
  /** Canonical unit as a UCUM code; null only for the open `other` entry. */
  readonly canonicalUnit: string | null;
  /** Canonical unit as printed — must equal the V1 `unit` in `report-analytes.ts`. */
  readonly canonicalUnitDisplay: string | null;
  /** Other spellings of the canonical unit seen on reports. */
  readonly canonicalUnitAliases?: readonly string[];
  /** Other units the value is printed in, each with its factor to canonical. */
  readonly allowedEnteredUnits: readonly UnitConversion[];
  /** True for the three docs/34 named review items. */
  readonly gate1bReview: boolean;
  /** Free-text note for the Gate 1b reviewer (why null, which candidates, what to decide). */
  readonly reviewNote?: string;
  /** True for `other`: intentionally uncoded, requires a free-text label. */
  readonly openEntry?: boolean;
}

// ---------------------------------------------------------------------------
// Shared conversions. `factor` = multiply the entered value by this to get the
// canonical unit. Molar masses: glucose 180.16, cholesterol 386.65,
// triglyceride (as triolein) 885.4, creatinine 113.12, urea 60.06, uric acid
// 168.11, bilirubin 584.66, 25-OH vitamin D 400.64, cobalamin 1355.4,
// T3 650.97, T4 776.87.
// ---------------------------------------------------------------------------

const MMOL_L_TO_MG_DL_GLUCOSE: UnitConversion = {
  unit: "mmol/L",
  display: "mmol/L",
  factor: 18.0182,
  note: "glucose molar mass 180.16 g/mol",
};
const MMOL_L_TO_MG_DL_CHOLESTEROL: UnitConversion = {
  unit: "mmol/L",
  display: "mmol/L",
  factor: 38.67,
  note: "cholesterol molar mass 386.65 g/mol",
};
const MMOL_L_TO_MG_DL_TRIGLYCERIDES: UnitConversion = {
  unit: "mmol/L",
  display: "mmol/L",
  factor: 88.57,
  note: "triglyceride (triolein) molar mass 885.4 g/mol",
};
const UMOL_L_TO_MG_DL_CREATININE: UnitConversion = {
  unit: "umol/L",
  display: "µmol/L",
  aliases: ["mcmol/L"],
  factor: 1 / 88.42,
  note: "creatinine molar mass 113.12 g/mol (mg/dL × 88.42 = µmol/L)",
};
const MMOL_L_TO_MG_DL_UREA: UnitConversion = {
  unit: "mmol/L",
  display: "mmol/L",
  factor: 6.006,
  note: "urea molar mass 60.06 g/mol; this converts urea to urea, NOT urea to BUN",
};
const UMOL_L_TO_MG_DL_URIC_ACID: UnitConversion = {
  unit: "umol/L",
  display: "µmol/L",
  aliases: ["mcmol/L"],
  factor: 1 / 59.48,
  note: "uric acid molar mass 168.11 g/mol (mg/dL × 59.48 = µmol/L)",
};
const UMOL_L_TO_MG_DL_BILIRUBIN: UnitConversion = {
  unit: "umol/L",
  display: "µmol/L",
  aliases: ["mcmol/L"],
  factor: 1 / 17.104,
  note: "bilirubin molar mass 584.66 g/mol (mg/dL × 17.104 = µmol/L)",
};
const G_L_TO_G_DL: UnitConversion = { unit: "g/L", display: "g/L", factor: 0.1 };
const UKAT_L_TO_U_L: UnitConversion = {
  unit: "ukat/L",
  display: "µkat/L",
  aliases: ["mckat/L"],
  factor: 60,
  note: "1 µkat/L = 60 U/L",
};
const MMOL_L_TO_MEQ_L_MONOVALENT: UnitConversion = {
  unit: "mmol/L",
  display: "mmol/L",
  factor: 1,
  note: "monovalent ion: mEq/L and mmol/L are numerically identical",
};

// ---------------------------------------------------------------------------

export const ANALYTES_V1: readonly AnalyteEntry[] = [
  // --- Blood counts (CBC) --------------------------------------------------
  {
    key: "hemoglobin",
    display: "Hemoglobin (Hb)",
    group: "cbc",
    loincCode: "718-7",
    loincDisplay: "Hemoglobin [Mass/volume] in Blood",
    canonicalUnit: "g/dL",
    canonicalUnitDisplay: "g/dL",
    canonicalUnitAliases: ["gm/dL", "gm%", "g%"],
    allowedEnteredUnits: [G_L_TO_G_DL],
    gate1bReview: false,
  },
  {
    key: "rbc_count",
    display: "RBC Count",
    group: "cbc",
    loincCode: "789-8",
    loincDisplay: "Erythrocytes [#/volume] in Blood by Automated count",
    canonicalUnit: "10*6/uL",
    canonicalUnitDisplay: "million/µL",
    canonicalUnitAliases: ["million/cumm", "mill/cumm", "10^6/µL", "x10^6/µL", "10*12/L", "x10^12/L", "M/µL"],
    allowedEnteredUnits: [],
    gate1bReview: false,
  },
  {
    key: "wbc_total",
    display: "Total WBC Count (TLC)",
    group: "cbc",
    loincCode: "6690-2",
    loincDisplay: "Leukocytes [#/volume] in Blood by Automated count",
    canonicalUnit: "/uL",
    canonicalUnitDisplay: "/µL",
    canonicalUnitAliases: ["/cumm", "cells/µL", "cells/cumm", "/mm3", "cells/mm3"],
    allowedEnteredUnits: [
      {
        unit: "10*3/uL",
        display: "thousand/µL",
        aliases: ["10^3/µL", "x10^3/µL", "K/µL", "10*9/L", "x10^9/L", "thou/cumm"],
        factor: 1000,
      },
    ],
    gate1bReview: false,
  },
  {
    key: "platelet_count",
    display: "Platelet Count",
    group: "cbc",
    loincCode: "777-3",
    loincDisplay: "Platelets [#/volume] in Blood by Automated count",
    canonicalUnit: "/uL",
    canonicalUnitDisplay: "/µL",
    canonicalUnitAliases: ["/cumm", "/mm3"],
    allowedEnteredUnits: [
      {
        unit: "10*3/uL",
        display: "thousand/µL",
        aliases: ["10^3/µL", "x10^3/µL", "K/µL", "10*9/L", "x10^9/L", "thou/cumm"],
        factor: 1000,
      },
      {
        unit: "10*5/uL",
        display: "lakhs/cumm",
        aliases: ["lakh/cumm", "lakhs/µL", "lac/cumm", "lacs/cumm"],
        factor: 100000,
        note: "Indian reports print e.g. 2.5 lakhs/cumm = 250,000/µL",
      },
    ],
    gate1bReview: true,
    reviewNote:
      "docs/34 review item: Indian labs print platelets both as absolute /cumm and as lakhs/cumm. " +
      "Canonical kept as absolute /µL; lakhs mapped as an entered unit (×100000). Reviewer to confirm " +
      "the canonical choice and whether the picker should default to lakhs for hand transcription.",
  },
  {
    key: "hematocrit",
    display: "Hematocrit (PCV)",
    group: "cbc",
    loincCode: "4544-3",
    loincDisplay: "Hematocrit [Volume Fraction] of Blood by Automated count",
    canonicalUnit: "%",
    canonicalUnitDisplay: "%",
    allowedEnteredUnits: [{ unit: "L/L", display: "L/L (fraction)", aliases: ["fraction"], factor: 100 }],
    gate1bReview: false,
  },

  // --- Blood sugar ---------------------------------------------------------
  {
    key: "fasting_glucose",
    display: "Fasting Blood Sugar (FBS)",
    group: "diabetes",
    loincCode: "1558-6",
    loincDisplay: "Fasting glucose [Mass/volume] in Serum or Plasma",
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%", "mg/100mL"],
    allowedEnteredUnits: [MMOL_L_TO_MG_DL_GLUCOSE],
    gate1bReview: false,
  },
  {
    key: "post_prandial_glucose",
    display: "Post Prandial Blood Sugar (PPBS)",
    group: "diabetes",
    loincCode: null,
    loincDisplay: null,
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%", "mg/100mL"],
    allowedEnteredUnits: [MMOL_L_TO_MG_DL_GLUCOSE],
    gate1bReview: false,
    reviewNote:
      "Candidates: 1521-4 (Glucose [Mass/volume] in Serum or Plasma --2 hours post meal) or " +
      "6689-4 (Glucose [Mass/volume] in Blood --2 hours post meal). Indian PPBS is usually 2h post-meal on " +
      "serum/plasma, so 1521-4 is the likely pick; left null until the reviewer confirms the timing semantics.",
  },
  {
    key: "hba1c",
    display: "HbA1c",
    group: "diabetes",
    loincCode: "4548-4",
    loincDisplay: "Hemoglobin A1c/Hemoglobin.total in Blood",
    canonicalUnit: "%",
    canonicalUnitDisplay: "%",
    canonicalUnitAliases: ["% NGSP", "NGSP %"],
    allowedEnteredUnits: [
      {
        unit: "mmol/mol",
        display: "mmol/mol (IFCC)",
        aliases: ["mmol/mol IFCC"],
        factor: 0.09148,
        offset: 2.152,
        note: "NGSP % = 0.09148 × IFCC mmol/mol + 2.152 (master equation)",
      },
    ],
    gate1bReview: false,
  },

  // --- Lipid profile -------------------------------------------------------
  {
    key: "total_cholesterol",
    display: "Total Cholesterol",
    group: "lipids",
    loincCode: "2093-3",
    loincDisplay: "Cholesterol [Mass/volume] in Serum or Plasma",
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [MMOL_L_TO_MG_DL_CHOLESTEROL],
    gate1bReview: false,
  },
  {
    key: "ldl_cholesterol",
    display: "LDL Cholesterol",
    group: "lipids",
    loincCode: "13457-7",
    loincDisplay: "Cholesterol in LDL [Mass/volume] in Serum or Plasma by calculation",
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [MMOL_L_TO_MG_DL_CHOLESTEROL],
    gate1bReview: false,
    reviewNote:
      "Mapped to the calculated (Friedewald) code 13457-7 because that is what most Indian lipid panels report. " +
      "Direct-measured LDL is 18262-6; a future `method` field on DiagnosticResult could pick between them.",
  },
  {
    key: "hdl_cholesterol",
    display: "HDL Cholesterol",
    group: "lipids",
    loincCode: "2085-9",
    loincDisplay: "Cholesterol in HDL [Mass/volume] in Serum or Plasma",
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [MMOL_L_TO_MG_DL_CHOLESTEROL],
    gate1bReview: false,
  },
  {
    key: "triglycerides",
    display: "Triglycerides",
    group: "lipids",
    loincCode: "2571-8",
    loincDisplay: "Triglyceride [Mass/volume] in Serum or Plasma",
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [MMOL_L_TO_MG_DL_TRIGLYCERIDES],
    gate1bReview: false,
  },

  // --- Liver function (LFT) ------------------------------------------------
  {
    key: "bilirubin_total",
    display: "Total Bilirubin",
    group: "liver",
    loincCode: "1975-2",
    loincDisplay: "Bilirubin.total [Mass/volume] in Serum or Plasma",
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [UMOL_L_TO_MG_DL_BILIRUBIN],
    gate1bReview: false,
  },
  {
    key: "sgpt_alt",
    display: "SGPT (ALT)",
    group: "liver",
    loincCode: "1742-6",
    loincDisplay: "Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma",
    canonicalUnit: "U/L",
    canonicalUnitDisplay: "U/L",
    canonicalUnitAliases: ["IU/L", "U/l"],
    allowedEnteredUnits: [UKAT_L_TO_U_L],
    gate1bReview: false,
  },
  {
    key: "sgot_ast",
    display: "SGOT (AST)",
    group: "liver",
    loincCode: "1920-8",
    loincDisplay: "Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma",
    canonicalUnit: "U/L",
    canonicalUnitDisplay: "U/L",
    canonicalUnitAliases: ["IU/L", "U/l"],
    allowedEnteredUnits: [UKAT_L_TO_U_L],
    gate1bReview: false,
  },
  {
    key: "alkaline_phosphatase",
    display: "Alkaline Phosphatase (ALP)",
    group: "liver",
    loincCode: "6768-6",
    loincDisplay: "Alkaline phosphatase [Enzymatic activity/volume] in Serum or Plasma",
    canonicalUnit: "U/L",
    canonicalUnitDisplay: "U/L",
    canonicalUnitAliases: ["IU/L", "U/l"],
    allowedEnteredUnits: [UKAT_L_TO_U_L],
    gate1bReview: false,
  },
  {
    key: "total_protein",
    display: "Total Protein",
    group: "liver",
    loincCode: "2885-2",
    loincDisplay: "Protein [Mass/volume] in Serum or Plasma",
    canonicalUnit: "g/dL",
    canonicalUnitDisplay: "g/dL",
    canonicalUnitAliases: ["gm/dL", "gm%", "g%"],
    allowedEnteredUnits: [G_L_TO_G_DL],
    gate1bReview: false,
  },
  {
    key: "albumin",
    display: "Albumin",
    group: "liver",
    loincCode: "1751-7",
    loincDisplay: "Albumin [Mass/volume] in Serum or Plasma",
    canonicalUnit: "g/dL",
    canonicalUnitDisplay: "g/dL",
    canonicalUnitAliases: ["gm/dL", "gm%", "g%"],
    allowedEnteredUnits: [G_L_TO_G_DL],
    gate1bReview: false,
  },

  // --- Kidney function (KFT) -----------------------------------------------
  {
    key: "creatinine",
    display: "Serum Creatinine",
    group: "kidney",
    loincCode: "2160-0",
    loincDisplay: "Creatinine [Mass/volume] in Serum or Plasma",
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [UMOL_L_TO_MG_DL_CREATININE],
    gate1bReview: false,
  },
  {
    key: "urea",
    display: "Blood Urea",
    group: "kidney",
    loincCode: null,
    loincDisplay: null,
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [MMOL_L_TO_MG_DL_UREA],
    gate1bReview: true,
    reviewNote:
      "docs/34 review item: 'Blood Urea' (urea, mg/dL) and BUN (urea nitrogen, mg/dL) are different analytes " +
      "(BUN = urea × 28/60 ≈ 0.467) and Indian labs print both under similar headings. Candidates: " +
      "3091-6 (Urea [Mass/volume] in Serum or Plasma) for urea; 3094-0 (Urea nitrogen [Mass/volume] in Serum or " +
      "Plasma) or 6299-2 (Urea nitrogen [Mass/volume] in Blood) for BUN. Reviewer to decide whether V2 keeps one " +
      "key with a method flag or splits `urea` / `bun` into two keys. Left null so it is never exported under the " +
      "wrong code.",
  },
  {
    key: "uric_acid",
    display: "Uric Acid",
    group: "kidney",
    loincCode: "3084-1",
    loincDisplay: "Urate [Mass/volume] in Serum or Plasma",
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [UMOL_L_TO_MG_DL_URIC_ACID],
    gate1bReview: false,
  },

  // --- Thyroid profile -----------------------------------------------------
  {
    key: "tsh",
    display: "TSH",
    group: "thyroid",
    loincCode: "3016-3",
    loincDisplay: "Thyrotropin [Units/volume] in Serum or Plasma",
    canonicalUnit: "u[IU]/mL",
    canonicalUnitDisplay: "µIU/mL",
    canonicalUnitAliases: ["uIU/mL", "mcIU/mL", "µU/mL", "uU/mL"],
    allowedEnteredUnits: [
      { unit: "m[IU]/L", display: "mIU/L", aliases: ["mU/L"], factor: 1, note: "µIU/mL and mIU/L are numerically identical" },
    ],
    gate1bReview: false,
  },
  {
    key: "t3_total",
    display: "T3 (Total)",
    group: "thyroid",
    loincCode: "3053-6",
    loincDisplay: "Triiodothyronine [Mass/volume] in Serum or Plasma",
    canonicalUnit: "ng/dL",
    canonicalUnitDisplay: "ng/dL",
    allowedEnteredUnits: [
      { unit: "ng/mL", display: "ng/mL", factor: 100, note: "1 ng/mL = 100 ng/dL" },
      { unit: "nmol/L", display: "nmol/L", factor: 65.1, note: "T3 molar mass 650.97 g/mol" },
    ],
    gate1bReview: true,
    reviewNote:
      "docs/34 review item: Indian labs print total T3 in both ng/mL (typ. 0.8–2.0) and ng/dL (typ. 80–200). " +
      "Canonical kept as ng/dL with ng/mL as an entered unit (×100). A value entered without a unit is ambiguous " +
      "by two orders of magnitude; reviewer to confirm the canonical choice and whether the picker must force a " +
      "unit selection for this analyte. Code 3053-6 to be verified against the total (not free) T3 semantics.",
  },
  {
    key: "t4_total",
    display: "T4 (Total)",
    group: "thyroid",
    loincCode: "3026-2",
    loincDisplay: "Thyroxine (T4) [Mass/volume] in Serum or Plasma",
    canonicalUnit: "ug/dL",
    canonicalUnitDisplay: "µg/dL",
    canonicalUnitAliases: ["mcg/dL"],
    allowedEnteredUnits: [
      { unit: "nmol/L", display: "nmol/L", factor: 1 / 12.87, note: "T4 molar mass 776.87 g/mol (µg/dL × 12.87 = nmol/L)" },
    ],
    gate1bReview: false,
  },

  // --- Vitamins ------------------------------------------------------------
  {
    key: "vitamin_d",
    display: "Vitamin D (25-OH)",
    group: "vitamins",
    loincCode: "1989-3",
    loincDisplay: "25-hydroxyvitamin D3 [Mass/volume] in Serum or Plasma",
    canonicalUnit: "ng/mL",
    canonicalUnitDisplay: "ng/mL",
    canonicalUnitAliases: ["ug/L", "µg/L"],
    allowedEnteredUnits: [
      { unit: "nmol/L", display: "nmol/L", factor: 1 / 2.496, note: "25-OH-D molar mass 400.64 g/mol (ng/mL × 2.496 = nmol/L)" },
    ],
    gate1bReview: false,
    reviewNote:
      "1989-3 is the D3-specific code; total 25-OH vitamin D (D2+D3, what most Indian immunoassays report) is " +
      "62292-8. Kept 1989-3 per the ticket; reviewer may prefer 62292-8.",
  },
  {
    key: "vitamin_b12",
    display: "Vitamin B12",
    group: "vitamins",
    loincCode: "2132-9",
    loincDisplay: "Cobalamin (Vitamin B12) [Mass/volume] in Serum or Plasma",
    canonicalUnit: "pg/mL",
    canonicalUnitDisplay: "pg/mL",
    canonicalUnitAliases: ["ng/L"],
    allowedEnteredUnits: [
      { unit: "pmol/L", display: "pmol/L", factor: 1 / 0.7378, note: "cobalamin molar mass 1355.4 g/mol (pg/mL × 0.7378 = pmol/L)" },
    ],
    gate1bReview: false,
  },

  // --- Electrolytes --------------------------------------------------------
  {
    key: "sodium",
    display: "Sodium (Na+)",
    group: "electrolytes",
    loincCode: "2951-2",
    loincDisplay: "Sodium [Moles/volume] in Serum or Plasma",
    canonicalUnit: "meq/L",
    canonicalUnitDisplay: "mEq/L",
    allowedEnteredUnits: [MMOL_L_TO_MEQ_L_MONOVALENT],
    gate1bReview: false,
  },
  {
    key: "potassium",
    display: "Potassium (K+)",
    group: "electrolytes",
    loincCode: "2823-3",
    loincDisplay: "Potassium [Moles/volume] in Serum or Plasma",
    canonicalUnit: "meq/L",
    canonicalUnitDisplay: "mEq/L",
    allowedEnteredUnits: [MMOL_L_TO_MEQ_L_MONOVALENT],
    gate1bReview: false,
  },

  // --- Inflammation markers ------------------------------------------------
  {
    key: "crp",
    display: "CRP",
    group: "inflammation",
    loincCode: "1988-5",
    loincDisplay: "C reactive protein [Mass/volume] in Serum or Plasma",
    canonicalUnit: "mg/L",
    canonicalUnitDisplay: "mg/L",
    allowedEnteredUnits: [{ unit: "mg/dL", display: "mg/dL", factor: 10 }],
    gate1bReview: false,
    reviewNote:
      "Standard CRP only. High-sensitivity CRP (hs-CRP, 30522-7) is a different test and must not share this key.",
  },
  {
    key: "esr",
    display: "ESR",
    group: "inflammation",
    loincCode: null,
    loincDisplay: null,
    canonicalUnit: "mm/h",
    canonicalUnitDisplay: "mm/hr",
    canonicalUnitAliases: ["mm/1st hr", "mm in 1st hour", "mm/1hr", "mm/hour"],
    allowedEnteredUnits: [],
    gate1bReview: false,
    reviewNote:
      "Candidates: 4537-7 (Erythrocyte sedimentation rate by Westergren) vs 30341-2 (method-agnostic). Indian " +
      "labs use Westergren and Wintrobe; left null until the reviewer decides whether the method is captured.",
  },

  // --- Open entry ----------------------------------------------------------
  {
    key: "other",
    display: "Other test value",
    group: "other",
    loincCode: null,
    loincDisplay: null,
    canonicalUnit: null,
    canonicalUnitDisplay: null,
    allowedEnteredUnits: [],
    gate1bReview: false,
    openEntry: true,
    reviewNote: "Open entry by design: free-text label, no code, no unit, never trended.",
  },
];
