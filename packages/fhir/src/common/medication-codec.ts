import type {
  CanonicalDosage,
  CanonicalMedication,
  CanonicalMedicationRequest,
  CanonicalMedicationStatement,
  FoodInstruction,
  FrequencyCode,
  MedicationStatus,
} from "../canonical/medication.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import {
  CODE_SYSTEMS,
  MEDPASS_SYSTEMS,
  type CodeableConcept,
  type Dosage,
  type MedicationIngredient,
  type MedicationRequestResource,
  type MedicationResource,
  type MedicationStatementResource,
  type MedicationStatementStatus,
  type Quantity,
  type TimingRepeat,
} from "./r4.js";
import { patientReference, reference } from "./references.js";

// ---- Medication (catalog) --------------------------------------------------------------------

/** Canonical product → R4 `Medication`. RxNorm when mapped, else the local CodeSystem keyed by product id (docs_v2/08 §3). */
export function medicationToResource(input: CanonicalMedication, profileUrl: string): MedicationResource {
  const c = requireProvenanceOf("MedicationProduct", input);
  const text = c.strengthLabel ? `${c.displayText} ${c.strengthLabel}` : c.displayText;
  const code: CodeableConcept = { text };
  if (c.codeSystem && c.code) {
    code.coding = [c.codeDisplay ? { system: c.codeSystem, code: c.code, display: c.codeDisplay } : { system: c.codeSystem, code: c.code }];
  } else {
    code.coding = [{ system: MEDPASS_SYSTEMS.csMedication, code: c.id, display: c.displayText }];
  }
  const resource: MedicationResource = {
    resourceType: "Medication",
    id: c.id,
    meta: { profile: [profileUrl] },
    code,
  };
  if (c.formText) resource.form = { text: c.formText };
  const ingredients = c.ingredients.map(ingredientOf);
  if (ingredients.length > 0) resource.ingredient = ingredients;
  return resource;
}

function ingredientOf(i: CanonicalMedication["ingredients"][number]): MedicationIngredient {
  const out: MedicationIngredient = { itemCodeableConcept: { text: i.text } };
  if (i.strengthValue !== null && Number.isFinite(Number(i.strengthValue))) {
    const numerator: Quantity = { value: Number(i.strengthValue) };
    if (i.strengthUnit) numerator.unit = i.strengthUnit;
    out.strength = { numerator, denominator: { value: 1 } };
  }
  return out;
}

// ---- Dosage ---------------------------------------------------------------------------------

/** FHIR EventTiming codes per slot — mirrors `proposeSlots()` in @medpass/medication-terminology. */
const SLOT_WHEN: Readonly<Record<"morning" | "midday" | "night", string>> = { morning: "MORN", midday: "AFT", night: "NIGHT" };

/**
 * `timing.repeat` for a frequency code (docs_v2/08 §6 #3: `when` from slots). Codes that need
 * patient-specific setup (QID, SOS, ALTERNATE_DAY, CUSTOM) get the period they imply, never invented slots.
 */
export function timingRepeatFor(code: FrequencyCode, pattern: string | null): TimingRepeat | null {
  switch (code) {
    case "OD":
      return { frequency: 1, period: 1, periodUnit: "d", when: [SLOT_WHEN.morning] };
    case "OD_AFTERNOON":
      return { frequency: 1, period: 1, periodUnit: "d", when: [SLOT_WHEN.midday] };
    case "BD":
      return { frequency: 2, period: 1, periodUnit: "d", when: [SLOT_WHEN.morning, SLOT_WHEN.night] };
    case "TDS":
      return { frequency: 3, period: 1, periodUnit: "d", when: [SLOT_WHEN.morning, SLOT_WHEN.midday, SLOT_WHEN.night] };
    case "QID":
      return { frequency: 4, period: 1, periodUnit: "d" };
    case "HS":
      return { frequency: 1, period: 1, periodUnit: "d", when: ["HS"] };
    case "PATTERN": {
      const when = patternWhen(pattern);
      return when ? { frequency: when.length, period: 1, periodUnit: "d", when } : null;
    }
    case "ALTERNATE_DAY":
      return { frequency: 1, period: 2, periodUnit: "d" };
    case "WEEKLY":
      return { frequency: 1, period: 1, periodUnit: "wk" };
    case "FORTNIGHTLY":
      return { frequency: 1, period: 2, periodUnit: "wk" };
    case "MONTHLY":
      return { frequency: 1, period: 1, periodUnit: "mo" };
    case "SOS":
    case "CUSTOM":
      return null;
  }
}

/** "1-0-1" → [MORN, NIGHT]; malformed or all-zero → null (never a guess). */
export function patternWhen(pattern: string | null): string[] | null {
  if (!pattern) return null;
  const m = /^(\d(?:\.\d)?)-(\d(?:\.\d)?)-(\d(?:\.\d)?)$/.exec(pattern.trim());
  if (!m) return null;
  const slots = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (slots.some((n) => Number.isNaN(n) || n > 10)) return null;
  const when: string[] = [];
  if (slots[0]! > 0) when.push(SLOT_WHEN.morning);
  if (slots[1]! > 0) when.push(SLOT_WHEN.midday);
  if (slots[2]! > 0) when.push(SLOT_WHEN.night);
  return when.length > 0 ? when : null;
}

const FOOD_TEXT: Record<FoodInstruction, string | null> = {
  before: "Before food",
  with: "With food",
  after: "After food",
  bedtime: "At bedtime",
  any: null,
};

/** Canonical dosage line → R4 `Dosage`. Original text is always preserved in `Dosage.text`. */
export function dosageToElement(d: CanonicalDosage, isPrn = false): Dosage {
  const dosage: Dosage = {};
  if (d.text) dosage.text = d.text;
  const food = d.foodInstruction ? FOOD_TEXT[d.foodInstruction] : null;
  if (food) dosage.additionalInstruction = [{ text: food }];

  if (d.frequencyCode) {
    const repeat = timingRepeatFor(d.frequencyCode, d.pattern);
    if (d.durationDays !== null && d.durationDays > 0) {
      const bounds: Quantity = { value: d.durationDays, unit: "d", system: CODE_SYSTEMS.ucum, code: "d" };
      dosage.timing = { repeat: { boundsDuration: bounds, ...(repeat ?? {}) } };
    } else if (repeat) {
      dosage.timing = { repeat };
    }
    const codeText = d.frequencyCode === "PATTERN" && d.pattern ? `PATTERN ${d.pattern}` : d.frequencyCode;
    dosage.timing = { ...(dosage.timing ?? {}), code: { coding: [{ system: MEDPASS_SYSTEMS.csFrequency, code: d.frequencyCode }], text: codeText } };
    if (d.frequencyCode === "SOS") dosage.asNeededBoolean = true;
  }
  if (isPrn) dosage.asNeededBoolean = true;
  if (d.routeText) dosage.route = { text: d.routeText };
  if (d.doseQuantity !== null && Number.isFinite(Number(d.doseQuantity))) {
    const doseQuantity: Quantity = { value: Number(d.doseQuantity) };
    if (d.doseUnit) doseQuantity.unit = d.doseUnit;
    dosage.doseAndRate = [{ doseQuantity }];
  }
  return dosage;
}

// ---- MedicationRequest ----------------------------------------------------------------------

/** `PrescriptionItem` (+ instruction) → R4 `MedicationRequest` (intent `order`). */
export function medicationRequestToResource(input: CanonicalMedicationRequest, profileUrl: string): MedicationRequestResource {
  const c = requireProvenanceOf("PrescriptionItem", input);
  const resource: MedicationRequestResource = {
    resourceType: "MedicationRequest",
    id: c.id,
    meta: { profile: [profileUrl] },
    identifier: [{ system: MEDPASS_SYSTEMS.prescription, value: `${c.prescriptionId}#${c.sequence}` }],
    status: c.completed ? "completed" : "active",
    intent: "order",
    subject: patientReference(c.patient),
    groupIdentifier: { system: MEDPASS_SYSTEMS.prescription, value: c.prescriptionId },
  };
  if (c.medicationId) {
    resource.medicationReference = { reference: `Medication/${c.medicationId}`, display: c.enteredName };
  } else {
    resource.medicationCodeableConcept = { text: [c.enteredName, c.strengthLabel, c.formText].filter(Boolean).join(" ") };
  }
  if (c.authoredOn) resource.authoredOn = c.authoredOn;
  if (c.practitionerId) resource.requester = reference("Practitioner", c.practitionerId);
  if (c.encounterId) resource.encounter = reference("Encounter", c.encounterId);
  resource.dosageInstruction = [dosageToElement(c.dosage)];
  return resource;
}

// ---- MedicationStatement --------------------------------------------------------------------

/** docs_v2/08 §6 #4 status map. */
export const MEDICATION_STATEMENT_STATUS: Readonly<Record<MedicationStatus, MedicationStatementStatus>> = {
  current: "active",
  paused: "on-hold",
  completed: "completed",
  stopped: "stopped",
  unknown: "unknown",
};

/** `PatientMedication` → R4 `MedicationStatement`; `informationSource` is always the patient. */
export function medicationStatementToResource(input: CanonicalMedicationStatement, profileUrl: string): MedicationStatementResource {
  const c = requireProvenanceOf("PatientMedication", input);
  const subject = patientReference(c.patient);
  const resource: MedicationStatementResource = {
    resourceType: "MedicationStatement",
    id: c.id,
    meta: { profile: [profileUrl] },
    status: MEDICATION_STATEMENT_STATUS[c.status],
    category: { coding: [{ system: CODE_SYSTEMS.medicationStatementCategory, code: "patientspecified", display: "Patient Specified" }] },
    subject,
    dateAsserted: c.provenance.recordedAt,
    informationSource: { reference: subject.reference! },
  };
  if (c.medicationId) {
    resource.medicationReference = { reference: `Medication/${c.medicationId}`, display: c.enteredName };
  } else {
    resource.medicationCodeableConcept = { text: c.enteredName };
  }
  if (c.startDate || c.endDate) {
    resource.effectivePeriod = { ...(c.startDate ? { start: c.startDate } : {}), ...(c.endDate ? { end: c.endDate } : {}) };
  }
  if (c.patientReason) resource.reasonCode = [{ text: c.patientReason }];
  if (c.reasonConditionId) resource.reasonReference = [reference("Condition", c.reasonConditionId)];
  if (c.dosage || c.isPrn) {
    resource.dosage = [dosageToElement(c.dosage ?? emptyDosage(), c.isPrn)];
  }
  return resource;
}

function emptyDosage(): CanonicalDosage {
  return { doseQuantity: null, doseUnit: null, frequencyCode: null, pattern: null, foodInstruction: null, durationDays: null, routeText: null, text: null };
}
