/**
 * `observation-concepts.v1` — LOINC vital-sign codes, canonical units and
 * plausibility bounds for every `ObservationConcept` in docs_v2/04 §5.2.
 *
 * Plausibility ranges are the "could a human plausibly have produced this
 * number" bounds that back the per-concept check constraints. They are NOT
 * clinical thresholds (docs_v2/04 §5.2: "plausibility only, e.g. SpO2 0–100,
 * never a clinical threshold"; docs/10 H-25: the app never interprets).
 *
 * Codes marked `null` are uncertain and listed in `listUnmapped()` for the
 * Gate 1b reviewer together with the candidate codes in `reviewNote`.
 */

import type { PlausibilityRange, UnitConversion } from "./types.js";

export const OBSERVATION_CONCEPT_KEYS_V1 = [
  "blood_pressure",
  "heart_rate",
  "blood_glucose",
  "body_weight",
  "body_height",
  "bmi",
  "spo2",
  "body_temperature",
  "respiratory_rate",
  "inr",
  "peak_flow",
  "pain_score",
  "insulin_dose",
  "fluid_intake",
  "fluid_output",
  "waist_circumference",
  "steps",
  "sleep_hours",
  "other",
] as const;
export type ObservationConceptKey = (typeof OBSERVATION_CONCEPT_KEYS_V1)[number];

export interface ObservationComponent {
  /** Which stored column this component lands in. */
  readonly slot: "valueNumeric" | "valueNumeric2";
  readonly display: string;
  readonly loincCode: string | null;
  readonly loincDisplay: string | null;
  readonly plausibility: PlausibilityRange;
}

export interface ObservationConceptEntry {
  readonly key: ObservationConceptKey;
  readonly display: string;
  /** Primary LOINC code (the panel code for two-value concepts). */
  readonly loincCode: string | null;
  readonly loincDisplay: string | null;
  /**
   * Codes that should be carried in addition to `loincCode` at the FHIR
   * boundary (e.g. the FHIR vital-signs profile wants 2708-6 as the magic
   * code for SpO2 while 59408-5 says "by pulse oximetry").
   */
  readonly additionalLoincCodes: readonly string[];
  /** Canonical unit as a UCUM code; null only for `other`. */
  readonly canonicalUnit: string | null;
  /** Canonical unit as shown in the UI (matches the docs_v2/04 §5.2 unit list). */
  readonly canonicalUnitDisplay: string | null;
  readonly canonicalUnitAliases?: readonly string[];
  readonly allowedEnteredUnits: readonly UnitConversion[];
  /** True when the concept stores two numbers (only blood pressure today). */
  readonly hasTwoValues: boolean;
  /** Plausibility for `valueNumeric`; null for text-only concepts. */
  readonly plausibility: PlausibilityRange | null;
  /** Present only when `hasTwoValues`; describes both slots with their own codes and bounds. */
  readonly components: readonly ObservationComponent[] | null;
  readonly reviewNote?: string;
  readonly openEntry?: boolean;
}

const DEG_F_TO_CEL: UnitConversion = {
  unit: "[degF]",
  display: "°F",
  aliases: ["F", "degF", "deg F", "fahrenheit"],
  factor: 5 / 9,
  offset: -160 / 9,
  note: "°C = (°F − 32) × 5/9",
};

export const OBSERVATION_CONCEPTS_V1: readonly ObservationConceptEntry[] = [
  {
    key: "blood_pressure",
    display: "Blood pressure",
    loincCode: "85354-9",
    loincDisplay: "Blood pressure panel with all children optional",
    additionalLoincCodes: [],
    canonicalUnit: "mm[Hg]",
    canonicalUnitDisplay: "mmHg",
    canonicalUnitAliases: ["mm Hg", "mm of Hg"],
    allowedEnteredUnits: [],
    hasTwoValues: true,
    plausibility: { min: 30, max: 300 },
    components: [
      {
        slot: "valueNumeric",
        display: "Systolic",
        loincCode: "8480-6",
        loincDisplay: "Systolic blood pressure",
        plausibility: { min: 30, max: 300 },
      },
      {
        slot: "valueNumeric2",
        display: "Diastolic",
        loincCode: "8462-4",
        loincDisplay: "Diastolic blood pressure",
        plausibility: { min: 10, max: 200 },
      },
    ],
  },
  {
    key: "heart_rate",
    display: "Heart rate",
    loincCode: "8867-4",
    loincDisplay: "Heart rate",
    additionalLoincCodes: [],
    canonicalUnit: "/min",
    canonicalUnitDisplay: "bpm",
    canonicalUnitAliases: ["beats/min", "beats per minute", "/minute"],
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 20, max: 300 },
    components: null,
  },
  {
    key: "blood_glucose",
    display: "Blood glucose",
    loincCode: "2339-0",
    loincDisplay: "Glucose [Mass/volume] in Blood",
    additionalLoincCodes: [],
    canonicalUnit: "mg/dL",
    canonicalUnitDisplay: "mg/dL",
    canonicalUnitAliases: ["mg%"],
    allowedEnteredUnits: [
      { unit: "mmol/L", display: "mmol/L", factor: 18.0182, note: "glucose molar mass 180.16 g/mol" },
    ],
    hasTwoValues: false,
    plausibility: { min: 10, max: 1000 },
    components: null,
    reviewNote:
      "2339-0 is whole-blood glucose (mass). Home glucometers are capillary fingerstick: 41653-7 " +
      "(Glucose [Mass/volume] in Capillary blood by Glucometer) may be preferred when `method = fingerstick`; " +
      "15074-8 is the molar (mmol/L) equivalent of 2339-0 and is not needed because values are stored canonical.",
  },
  {
    key: "body_weight",
    display: "Body weight",
    loincCode: "29463-7",
    loincDisplay: "Body weight",
    additionalLoincCodes: [],
    canonicalUnit: "kg",
    canonicalUnitDisplay: "kg",
    canonicalUnitAliases: ["kgs", "kilogram", "kilograms"],
    allowedEnteredUnits: [
      { unit: "[lb_av]", display: "lb", aliases: ["lbs", "pound", "pounds"], factor: 0.45359237 },
      { unit: "g", display: "g", aliases: ["gm", "grams"], factor: 0.001 },
    ],
    hasTwoValues: false,
    plausibility: { min: 0.5, max: 500 },
    components: null,
  },
  {
    key: "body_height",
    display: "Height",
    loincCode: "8302-2",
    loincDisplay: "Body height",
    additionalLoincCodes: [],
    canonicalUnit: "cm",
    canonicalUnitDisplay: "cm",
    canonicalUnitAliases: ["cms", "centimetre", "centimeter"],
    allowedEnteredUnits: [
      { unit: "m", display: "m", aliases: ["metre", "meter"], factor: 100 },
      { unit: "[in_i]", display: "in", aliases: ["inch", "inches", '"'], factor: 2.54 },
    ],
    hasTwoValues: false,
    plausibility: { min: 20, max: 272 },
    components: null,
  },
  {
    key: "bmi",
    display: "BMI",
    loincCode: "39156-5",
    loincDisplay: "Body mass index (BMI) [Ratio]",
    additionalLoincCodes: [],
    canonicalUnit: "kg/m2",
    canonicalUnitDisplay: "kg/m²",
    canonicalUnitAliases: ["kg/m^2"],
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 5, max: 100 },
    components: null,
  },
  {
    key: "spo2",
    display: "Oxygen saturation (SpO2)",
    loincCode: "2708-6",
    loincDisplay: "Oxygen saturation in Arterial blood",
    additionalLoincCodes: ["59408-5"],
    canonicalUnit: "%",
    canonicalUnitDisplay: "%",
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 0, max: 100 },
    components: null,
    reviewNote:
      "FHIR vital-signs `oxygensat` profile requires 2708-6 and recommends 59408-5 (by pulse oximetry) alongside " +
      "it; ABDM ObservationOxygenSat follows the same profile. Both are emitted.",
  },
  {
    key: "body_temperature",
    display: "Body temperature",
    loincCode: "8310-5",
    loincDisplay: "Body temperature",
    additionalLoincCodes: [],
    canonicalUnit: "Cel",
    canonicalUnitDisplay: "°C",
    canonicalUnitAliases: ["C", "degC", "deg C", "celsius", "centigrade"],
    allowedEnteredUnits: [DEG_F_TO_CEL],
    hasTwoValues: false,
    plausibility: { min: 25, max: 45 },
    components: null,
  },
  {
    key: "respiratory_rate",
    display: "Respiratory rate",
    loincCode: "9279-1",
    loincDisplay: "Respiratory rate",
    additionalLoincCodes: [],
    canonicalUnit: "/min",
    canonicalUnitDisplay: "/min",
    canonicalUnitAliases: ["breaths/min", "breaths per minute", "/minute"],
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 0, max: 100 },
    components: null,
  },
  {
    key: "inr",
    display: "INR",
    loincCode: "6301-6",
    loincDisplay: "INR in Platelet poor plasma by Coagulation assay",
    additionalLoincCodes: [],
    canonicalUnit: "{INR}",
    canonicalUnitDisplay: "ratio",
    canonicalUnitAliases: ["INR"],
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 0.5, max: 20 },
    components: null,
    reviewNote:
      "Home coagulometers (fingerstick) may map better to 34714-6 (INR in Blood by Coagulation assay); " +
      "6301-6 kept as the lab-equivalent default.",
  },
  {
    key: "peak_flow",
    display: "Peak expiratory flow",
    loincCode: "19935-8",
    loincDisplay: "Maximum expiratory gas flow Respiratory system airway by Peak flow meter",
    additionalLoincCodes: [],
    canonicalUnit: "L/min",
    canonicalUnitDisplay: "L/min",
    canonicalUnitAliases: ["l/min", "lpm"],
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 0, max: 1000 },
    components: null,
    reviewNote: "Code per ticket 0.28; reviewer to verify 19935-8 is the peak-flow-meter (home device) variant.",
  },
  {
    key: "pain_score",
    display: "Pain score (0–10)",
    loincCode: "72514-3",
    loincDisplay: "Pain severity - 0-10 verbal numeric rating [Score] - Reported",
    additionalLoincCodes: [],
    canonicalUnit: "{score}",
    canonicalUnitDisplay: "0–10",
    canonicalUnitAliases: ["score", "/10", "out of 10"],
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 0, max: 10 },
    components: null,
  },
  {
    key: "insulin_dose",
    display: "Insulin dose",
    loincCode: null,
    loincDisplay: null,
    additionalLoincCodes: [],
    canonicalUnit: "[IU]",
    canonicalUnitDisplay: "IU",
    canonicalUnitAliases: ["units", "unit", "U", "IU insulin"],
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 0, max: 500 },
    components: null,
    reviewNote:
      "An administered insulin dose is a MedicationAdministration, not a LOINC observation. Left null; at the " +
      "FHIR boundary this exports under the local CodeSystem unless the reviewer chooses a LOINC dose-log code.",
  },
  {
    key: "fluid_intake",
    display: "Fluid intake",
    loincCode: null,
    loincDisplay: null,
    additionalLoincCodes: [],
    canonicalUnit: "mL",
    canonicalUnitDisplay: "mL",
    canonicalUnitAliases: ["ml", "millilitre", "milliliter", "cc"],
    allowedEnteredUnits: [{ unit: "L", display: "L", aliases: ["litre", "liter"], factor: 1000 }],
    hasTwoValues: false,
    plausibility: { min: 0, max: 10000 },
    components: null,
    reviewNote: "Candidate: 8999-5 (Fluid intake oral Estimated) — unverified; wellness-record concept for ABDM.",
  },
  {
    key: "fluid_output",
    display: "Fluid output",
    loincCode: null,
    loincDisplay: null,
    additionalLoincCodes: [],
    canonicalUnit: "mL",
    canonicalUnitDisplay: "mL",
    canonicalUnitAliases: ["ml", "millilitre", "milliliter", "cc"],
    allowedEnteredUnits: [{ unit: "L", display: "L", aliases: ["litre", "liter"], factor: 1000 }],
    hasTwoValues: false,
    plausibility: { min: 0, max: 10000 },
    components: null,
    reviewNote: "Candidate: 9192-6 (Fluid output urine) — unverified; wellness-record concept for ABDM.",
  },
  {
    key: "waist_circumference",
    display: "Waist circumference",
    loincCode: null,
    loincDisplay: null,
    additionalLoincCodes: [],
    canonicalUnit: "cm",
    canonicalUnitDisplay: "cm",
    canonicalUnitAliases: ["cms"],
    allowedEnteredUnits: [{ unit: "[in_i]", display: "in", aliases: ["inch", "inches"], factor: 2.54 }],
    hasTwoValues: false,
    plausibility: { min: 20, max: 300 },
    components: null,
    reviewNote: "Candidates: 8280-0 (Waist Circumference at umbilicus by Tape measure) or 56086-2 (Waist circumference).",
  },
  {
    key: "steps",
    display: "Steps",
    loincCode: null,
    loincDisplay: null,
    additionalLoincCodes: [],
    canonicalUnit: "{steps}",
    canonicalUnitDisplay: "steps",
    canonicalUnitAliases: ["step"],
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: { min: 0, max: 200000 },
    components: null,
    reviewNote: "Candidates: 55423-8 (Number of steps in unspecified time Pedometer) or 41950-7 (Number of steps in 24 hour Measured).",
  },
  {
    key: "sleep_hours",
    display: "Sleep duration",
    loincCode: null,
    loincDisplay: null,
    additionalLoincCodes: [],
    canonicalUnit: "h",
    canonicalUnitDisplay: "hours",
    canonicalUnitAliases: ["hr", "hrs", "hour"],
    allowedEnteredUnits: [{ unit: "min", display: "min", aliases: ["minutes", "mins"], factor: 1 / 60 }],
    hasTwoValues: false,
    plausibility: { min: 0, max: 24 },
    components: null,
    reviewNote: "Candidate: 93832-4 (Sleep duration) — unverified.",
  },
  {
    key: "other",
    display: "Other",
    loincCode: null,
    loincDisplay: null,
    additionalLoincCodes: [],
    canonicalUnit: null,
    canonicalUnitDisplay: null,
    allowedEnteredUnits: [],
    hasTwoValues: false,
    plausibility: null,
    components: null,
    openEntry: true,
    reviewNote: "Open entry by design: `valueText` only, no code, no unit.",
  },
];
