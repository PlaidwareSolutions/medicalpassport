import { getAnalyte, getObservationConcept, type ObservationConceptEntry } from "@medpass/terminology";
import type { CanonicalLabObservation, ObservationInterpretation } from "../canonical/diagnostics.js";
import { VITAL_SIGN_CONCEPTS, type CanonicalVitalObservation, type ObservationConcept } from "../canonical/vital.js";
import { type CodecContext, type FhirValidationFailure, type SerializedResource, warning } from "./failure.js";
import { requireProvenanceOf } from "./provenance-guard.js";
import {
  CODE_SYSTEMS,
  MEDPASS_SYSTEMS,
  type CodeableConcept,
  type ObservationComponent,
  type ObservationReferenceRange,
  type ObservationResource,
  type Quantity,
} from "./r4.js";
import { patientReference, reference } from "./references.js";

const INTERPRETATION_TO_V3: Record<ObservationInterpretation, { code: string; display: string }> = {
  normal: { code: "N", display: "Normal" },
  high: { code: "H", display: "High" },
  low: { code: "L", display: "Low" },
  critical_high: { code: "HH", display: "Critical high" },
  critical_low: { code: "LL", display: "Critical low" },
  abnormal: { code: "A", display: "Abnormal" },
};

function interpretationConcept(i: ObservationInterpretation): CodeableConcept {
  const v3 = INTERPRETATION_TO_V3[i];
  return { coding: [{ system: CODE_SYSTEMS.observationInterpretation, code: v3.code, display: v3.display }] };
}

function ucumQuantity(value: number, unit: string | null, enteredUnit: string | null): Quantity {
  const q: Quantity = { value };
  if (unit) {
    q.unit = unit;
    q.system = CODE_SYSTEMS.ucum;
    q.code = unit;
  } else if (enteredUnit) {
    q.unit = enteredUnit;
  }
  return q;
}

// ---- Lab result --------------------------------------------------------------------------------

/**
 * `DiagnosticResult` → R4 `Observation` (laboratory). LOINC + UCUM come from the terminology
 * tables by `analyteKey`; a key with no LOINC (or `other`) is exported with the local analyte
 * CodeSystem + the printed label and reported as a warning (docs_v2/08 §6 #6).
 */
export function labObservationToResource(input: CanonicalLabObservation, ctx: CodecContext): SerializedResource<ObservationResource> {
  const c = requireProvenanceOf("DiagnosticResult", input);
  const warnings: FhirValidationFailure[] = [];
  const analyte = getAnalyte(c.analyteKey);
  const label = c.analyteKey === "other" ? (c.analyteLabelText ?? "Other test value") : (analyte?.display ?? c.analyteLabelText ?? c.analyteKey);

  const code: CodeableConcept = { text: label };
  const loinc = analyte?.loincCode ?? c.loincCode;
  if (loinc) {
    code.coding = [{ system: CODE_SYSTEMS.loinc, code: loinc, ...(analyte?.loincDisplay && analyte.loincCode === loinc ? { display: analyte.loincDisplay } : {}) }];
  } else {
    code.coding = [{ system: MEDPASS_SYSTEMS.csAnalyte, code: c.analyteKey, display: label }];
    warnings.push(warning(ctx, "Observation", "code", `analyte "${c.analyteKey}" has no LOINC mapping; exported with the local CodeSystem and text`));
  }

  const resource: ObservationResource = {
    resourceType: "Observation",
    id: c.id,
    meta: { profile: [ctx.profileUrl] },
    status: "final",
    category: [{ coding: [{ system: CODE_SYSTEMS.observationCategory, code: "laboratory", display: "Laboratory" }] }],
    code,
    subject: patientReference(c.patient),
    partOf: [reference("DiagnosticReport", c.diagnosticReportId)],
    extension: [{ url: MEDPASS_SYSTEMS.extEnteredValue, valueString: [c.enteredValueText, c.enteredUnit].filter(Boolean).join(" ") }],
  };
  if (c.effectiveAt) resource.effectiveDateTime = c.effectiveAt;

  const numeric = c.valueNumeric !== null ? Number(c.valueNumeric) : NaN;
  if (Number.isFinite(numeric)) {
    const q = ucumQuantity(numeric, c.unit, c.enteredUnit);
    if (c.comparator) q.comparator = c.comparator;
    resource.valueQuantity = q;
    if (!c.unit) {
      warnings.push(
        warning(ctx, "Observation", "valueQuantity.code", c.enteredUnit ? `unit "${c.enteredUnit}" is not a UCUM unit known for "${c.analyteKey}"; exported as free text` : "value has no unit"),
      );
    }
  } else {
    resource.valueString = c.valueText ?? c.enteredValueText;
  }
  if (c.interpretation) resource.interpretation = [interpretationConcept(c.interpretation)];
  const range = referenceRange(c);
  if (range) resource.referenceRange = [range];
  if (c.specimenType) resource.specimen = { display: c.specimenType };
  return { resource, warnings };
}

function referenceRange(c: CanonicalLabObservation): ObservationReferenceRange | null {
  const low = c.referenceLow !== null ? Number(c.referenceLow) : NaN;
  const high = c.referenceHigh !== null ? Number(c.referenceHigh) : NaN;
  if (!Number.isFinite(low) && !Number.isFinite(high) && !c.referenceText) return null;
  const range: ObservationReferenceRange = {};
  if (Number.isFinite(low)) range.low = ucumQuantity(low, c.unit, c.enteredUnit);
  if (Number.isFinite(high)) range.high = ucumQuantity(high, c.unit, c.enteredUnit);
  if (c.referenceText) range.text = c.referenceText;
  return range;
}

// ---- Vital signs / wellness ---------------------------------------------------------------------

/** Per-IG profile selection for one concept: the folder decides which URL a concept gets. */
export type VitalProfileResolver = (concept: ObservationConcept) => string;

/**
 * Generic `Observation` row → R4 `Observation`. Vital-sign concepts get the magic LOINC codes and
 * the vital-signs category; blood pressure is emitted with systolic/diastolic components
 * (docs_v2/08 §6 #9–#12). Non-vital concepts export as wellness observations (#8).
 */
export function vitalObservationToResource(
  input: CanonicalVitalObservation,
  ctx: Omit<CodecContext, "profileUrl">,
  profileFor: VitalProfileResolver,
): SerializedResource<ObservationResource> {
  const c = requireProvenanceOf("Observation", input);
  const profileUrl = profileFor(c.concept);
  const codecCtx: CodecContext = { igVersion: ctx.igVersion, profileUrl };
  const warnings: FhirValidationFailure[] = [];
  const entry = getObservationConcept(c.concept);
  const isVital = VITAL_SIGN_CONCEPTS.has(c.concept);
  const display = c.concept === "other" ? (c.conceptText ?? "Other measurement") : (entry?.display ?? c.concept);

  const code: CodeableConcept = { text: display };
  if (entry?.loincCode) {
    code.coding = [
      { system: CODE_SYSTEMS.loinc, code: entry.loincCode, ...(entry.loincDisplay ? { display: entry.loincDisplay } : {}) },
      ...entry.additionalLoincCodes.map((extra) => ({ system: CODE_SYSTEMS.loinc, code: extra })),
    ];
  } else {
    code.coding = [{ system: MEDPASS_SYSTEMS.csObservationConcept, code: c.concept, display }];
    warnings.push(warning(codecCtx, "Observation", "code", `observation concept "${c.concept}" has no LOINC mapping; exported with the local CodeSystem and text`));
  }

  const resource: ObservationResource = {
    resourceType: "Observation",
    id: c.id,
    meta: { profile: isVital ? uniq([profileUrl, CODE_SYSTEMS.vitalSignsProfile]) : [profileUrl] },
    status: "final",
    category: [
      isVital
        ? { coding: [{ system: CODE_SYSTEMS.observationCategory, code: "vital-signs", display: "Vital Signs" }] }
        : { coding: [{ system: CODE_SYSTEMS.observationCategory, code: "activity", display: "Activity" }] },
    ],
    code,
    subject: patientReference(c.patient),
    effectiveDateTime: c.measuredAt,
  };
  if (c.encounterId) resource.encounter = reference("Encounter", c.encounterId);

  const unit = entry?.canonicalUnit ?? null;
  const primary = c.valueNumeric !== null ? Number(c.valueNumeric) : NaN;
  const secondary = c.valueNumeric2 !== null ? Number(c.valueNumeric2) : NaN;

  if (entry?.hasTwoValues && entry.components) {
    resource.component = componentsOf(entry, primary, secondary, unit ?? c.unit);
  } else if (Number.isFinite(primary)) {
    resource.valueQuantity = ucumQuantity(primary, unit ?? (c.unit || null), c.enteredUnit);
    if (!unit) warnings.push(warning(codecCtx, "Observation", "valueQuantity.code", `unit "${c.unit}" for "${c.concept}" is not the terminology canonical unit; exported as stored`));
  } else if (c.valueText) {
    resource.valueString = c.valueText;
  } else {
    resource.dataAbsentReason = { coding: [{ system: "http://terminology.hl7.org/CodeSystem/data-absent-reason", code: "unknown" }] };
  }

  if (c.interpretation) resource.interpretation = [interpretationConcept(c.interpretation)];
  if (c.bodySite) resource.bodySite = { text: c.bodySite };
  if (c.method) resource.method = { text: c.method };
  if (c.context) resource.note = [{ text: `Context: ${c.context}` }, ...(c.notes ? [{ text: c.notes }] : [])];
  else if (c.notes) resource.note = [{ text: c.notes }];
  if (c.deviceId) resource.device = reference("Device", c.deviceId);
  if (c.enteredValueText) {
    resource.extension = [{ url: MEDPASS_SYSTEMS.extEnteredValue, valueString: [c.enteredValueText, c.enteredUnit].filter(Boolean).join(" ") }];
  }
  return { resource, warnings };
}

function componentsOf(entry: ObservationConceptEntry, primary: number, secondary: number, unit: string): ObservationComponent[] {
  const values = { valueNumeric: primary, valueNumeric2: secondary };
  return (entry.components ?? []).map((component) => {
    const value = values[component.slot];
    const code: CodeableConcept = { text: component.display };
    code.coding = component.loincCode
      ? [{ system: CODE_SYSTEMS.loinc, code: component.loincCode, ...(component.loincDisplay ? { display: component.loincDisplay } : {}) }]
      : [{ system: MEDPASS_SYSTEMS.csObservationConcept, code: `${entry.key}.${component.slot}`, display: component.display }];
    const out: ObservationComponent = { code };
    if (Number.isFinite(value)) out.valueQuantity = ucumQuantity(value, unit, null);
    else out.dataAbsentReason = { coding: [{ system: "http://terminology.hl7.org/CodeSystem/data-absent-reason", code: "unknown" }] };
    return out;
  });
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}
