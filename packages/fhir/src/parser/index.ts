/**
 * Inbound direction (docs_v2/08 section 2 `parser/`, section 7 import policy): a received FHIR
 * bundle becomes *candidate drafts* — never canonical rows. The API validates each draft against
 * the extraction target catalogue and stores it as a `DocumentCandidate`; only a patient
 * confirmation ever materializes it. Provenance is never recovered from the payload.
 *
 * Field names follow `@medpass/document-intelligence` `EXTRACTION_TARGETS` (copied, not imported,
 * to keep this package free of app-side dependencies); the API is the one that enforces them.
 */
import { findAnalyteByLoinc } from "@medpass/terminology";
import { patternWhen } from "../common/medication-codec.js";
import { CODE_SYSTEMS } from "../common/r4.js";
import type {
  AllergyIntoleranceResource,
  BundleResource,
  CodeableConcept,
  CompositionResource,
  ConditionResource,
  DiagnosticReportResource,
  Dosage,
  HumanName,
  MedicationRequestResource,
  MedicationStatementResource,
  ObservationResource,
  OrganizationResource,
  PractitionerResource,
  ResourceBase,
} from "../common/r4.js";

export const CANDIDATE_TARGET_ENTITIES = [
  "prescription",
  "practitioner",
  "organization",
  "medication",
  "diagnostic_report",
  "diagnostic_result",
  "condition",
  "allergy",
] as const;
export type CandidateTargetEntity = (typeof CANDIDATE_TARGET_ENTITIES)[number];

/** Dosage forms the extraction catalogue accepts for `medication.form` (mirrors `@medpass/document-intelligence`). */
const MEDICATION_FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "drops", "cream", "ointment", "gel", "inhaler", "sachet", "powder", "lotion", "other"] as const;

export interface ParsedCandidateDraft {
  targetEntity: CandidateTargetEntity;
  targetField: string;
  /** The FHIR value as text, kept verbatim for the confirmation screen. */
  detectedText: string;
  proposedValue: unknown;
  /** Structured data carries no OCR uncertainty; the patient's confirmation is still required. */
  confidence: 1;
  /** One group per source resource so a MedicationRequest's fields materialize as one medicine. */
  groupKey: string;
  sourceResourceType: string;
  sourceResourceId: string | null;
}

export interface ParsedBundle {
  candidates: ParsedCandidateDraft[];
  /** Entry resources this parser has no target for (Provenance, Encounter, Binary, …). */
  unsupported: Array<{ resourceType: string; id: string | null }>;
  resourceCount: number;
}

/** Walks every entry of a bundle (any type) and proposes candidates; never throws on a malformed entry. */
export function parseBundleToCandidates(bundle: unknown): ParsedBundle {
  const out: ParsedBundle = { candidates: [], unsupported: [], resourceCount: 0 };
  const entries = isBundle(bundle) ? (bundle.entry ?? []) : [];
  for (const entry of entries) {
    const resource = entry.resource;
    if (!resource || typeof resource !== "object" || typeof resource.resourceType !== "string") continue;
    out.resourceCount += 1;
    const drafts = parseResource(resource);
    if (drafts === null) out.unsupported.push({ resourceType: resource.resourceType, id: resource.id ?? null });
    else out.candidates.push(...drafts);
  }
  return out;
}

function isBundle(value: unknown): value is BundleResource {
  return typeof value === "object" && value !== null && (value as { resourceType?: unknown }).resourceType === "Bundle";
}

/** Candidates for one resource, `null` when the type has no extraction target. */
export function parseResource(resource: ResourceBase): ParsedCandidateDraft[] | null {
  switch (resource.resourceType) {
    case "AllergyIntolerance":
      return allergy(resource as AllergyIntoleranceResource);
    case "Condition":
      return condition(resource as ConditionResource);
    case "MedicationRequest":
      return medication(resource as MedicationRequestResource, (resource as MedicationRequestResource).dosageInstruction);
    case "MedicationStatement":
      return medication(resource as MedicationStatementResource, (resource as MedicationStatementResource).dosage);
    case "Observation":
      return observation(resource as ObservationResource);
    case "DiagnosticReport":
      return diagnosticReport(resource as DiagnosticReportResource);
    case "Practitioner":
      return practitioner(resource as PractitionerResource);
    case "Organization":
      return organization(resource as OrganizationResource);
    case "Composition":
      return composition(resource as CompositionResource);
    default:
      return null;
  }
}

// ---- helpers ------------------------------------------------------------------------------------

function draft(resource: ResourceBase, targetEntity: CandidateTargetEntity, targetField: string, detectedText: string, proposedValue: unknown): ParsedCandidateDraft {
  return {
    targetEntity,
    targetField,
    detectedText: detectedText.slice(0, 2000),
    proposedValue,
    confidence: 1,
    groupKey: `${resource.resourceType}/${resource.id ?? "unknown"}`,
    sourceResourceType: resource.resourceType,
    sourceResourceId: resource.id ?? null,
  };
}

function conceptText(concept: CodeableConcept | undefined): string | null {
  const text = concept?.text?.trim();
  if (text) return text;
  const display = concept?.coding?.find((c) => c.display)?.display?.trim();
  return display || null;
}

function nameText(name: HumanName | undefined): string | null {
  if (!name) return null;
  if (name.text?.trim()) return name.text.trim();
  const parts = [...(name.prefix ?? []), ...(name.given ?? []), name.family ?? ""].map((p) => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}

function dateOnly(value: string | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1]! : null;
}

// ---- per resource ---------------------------------------------------------------------------

function allergy(r: AllergyIntoleranceResource): ParsedCandidateDraft[] {
  const label = conceptText(r.code);
  return label ? [draft(r, "allergy", "label", label, label.slice(0, 200))] : [];
}

function condition(r: ConditionResource): ParsedCandidateDraft[] {
  const label = conceptText(r.code);
  return label ? [draft(r, "condition", "label", label, label.slice(0, 200))] : [];
}

const WHEN_TO_CODE: Array<{ when: string[]; code: string }> = [
  { when: ["MORN"], code: "OD" },
  { when: ["AFT"], code: "OD_AFTERNOON" },
  { when: ["MORN", "NIGHT"], code: "BD" },
  { when: ["MORN", "AFT", "NIGHT"], code: "TDS" },
  { when: ["HS"], code: "HS" },
  { when: ["NIGHT"], code: "HS" },
];

/** Only frequency codes the target catalogue lets an extractor propose. */
const PROPOSABLE = new Set(["OD", "BD", "TDS", "QID", "SOS", "HS", "PATTERN"]);

function frequencyOf(dosage: Dosage | undefined): { code: string; pattern?: string } | null {
  const repeat = dosage?.timing?.repeat;
  if (dosage?.asNeededBoolean) return { code: "SOS" };
  if (!repeat) return null;
  if (repeat.when && repeat.when.length > 0) {
    const key = [...repeat.when].sort().join(",");
    const match = WHEN_TO_CODE.find((m) => [...m.when].sort().join(",") === key);
    if (match && PROPOSABLE.has(match.code)) return { code: match.code };
    const pattern = ["MORN", "AFT", "NIGHT"].map((slot) => (repeat.when!.includes(slot) ? "1" : "0")).join("-");
    return patternWhen(pattern) ? { code: "PATTERN", pattern } : null;
  }
  if (repeat.periodUnit === "d" && repeat.period === 1 && repeat.frequency) {
    const byCount: Record<number, string> = { 1: "OD", 2: "BD", 3: "TDS", 4: "QID" };
    const code = byCount[repeat.frequency];
    return code ? { code } : null;
  }
  return null;
}

function medication(r: MedicationRequestResource | MedicationStatementResource, dosages: Dosage[] | undefined): ParsedCandidateDraft[] {
  const out: ParsedCandidateDraft[] = [];
  const name = conceptText(r.medicationCodeableConcept) ?? r.medicationReference?.display?.trim() ?? null;
  if (!name) return out;
  // "Pantoprazole 40 mg Tablet" → name + strength (+ form when it is one the catalogue knows).
  const strength = /^(.*?)\s+(\d+(?:\.\d+)?)\s*([A-Za-zµ%][A-Za-z0-9µ/%^.]*)(?:\s+([A-Za-z]+))?$/.exec(name);
  if (strength && strength[1]) {
    out.push(draft(r, "medication", "genericName", name, strength[1].trim().slice(0, 160)));
    out.push(draft(r, "medication", "strengthLabel", `${strength[2]} ${strength[3]}`, { value: strength[2]!, unit: strength[3]! }));
    const form = strength[4]?.toLowerCase();
    if (form && (MEDICATION_FORMS as readonly string[]).includes(form)) out.push(draft(r, "medication", "form", strength[4]!, form));
  } else {
    out.push(draft(r, "medication", "genericName", name, name.slice(0, 160)));
  }
  const dosage = dosages?.[0];
  if (dosage?.text) out.push(draft(r, "medication", "instructionsText", dosage.text, dosage.text.slice(0, 500)));
  const frequency = frequencyOf(dosage);
  if (frequency) {
    const text = dosage?.timing?.code?.text ?? (frequency.pattern ? `PATTERN ${frequency.pattern}` : frequency.code);
    out.push(draft(r, "medication", "frequency", text, frequency));
  }
  const food = dosage?.additionalInstruction?.map((a) => conceptText(a)?.toLowerCase() ?? "").find(Boolean);
  if (food) {
    const value = food.includes("before") ? "before" : food.includes("after") ? "after" : food.includes("with") ? "with" : food.includes("bedtime") ? "bedtime" : null;
    if (value) out.push(draft(r, "medication", "foodInstruction", food, value));
  }
  const bounds = dosage?.timing?.repeat?.boundsDuration;
  if (bounds?.value && (bounds.code === "d" || bounds.unit === "d" || bounds.unit === "days") && Number.isInteger(bounds.value) && bounds.value > 0 && bounds.value <= 365) {
    out.push(draft(r, "medication", "durationDays", `${bounds.value} days`, bounds.value));
  }
  return out;
}

function observation(r: ObservationResource): ParsedCandidateDraft[] {
  const laboratory = r.category?.some((c) => c.coding?.some((x) => x.code === "laboratory"));
  if (!laboratory) return [];
  const out: ParsedCandidateDraft[] = [];
  const label = conceptText(r.code);
  if (label) out.push(draft(r, "diagnostic_result", "analyteLabelText", label, label.slice(0, 120)));
  const loinc = r.code?.coding?.find((c) => c.system === CODE_SYSTEMS.loinc)?.code;
  const analyte = loinc ? findAnalyteByLoinc(loinc) : undefined;
  if (analyte) out.push(draft(r, "diagnostic_result", "analyteKey", loinc!, analyte.key));
  if (r.valueQuantity?.value !== undefined) {
    const text = String(r.valueQuantity.value);
    out.push(draft(r, "diagnostic_result", "enteredValueText", text, text.slice(0, 40)));
    const unit = r.valueQuantity.unit ?? r.valueQuantity.code;
    if (unit) out.push(draft(r, "diagnostic_result", "enteredUnit", unit, unit.slice(0, 24)));
    if (r.valueQuantity.comparator) out.push(draft(r, "diagnostic_result", "comparator", r.valueQuantity.comparator, r.valueQuantity.comparator));
  } else if (r.valueString) {
    out.push(draft(r, "diagnostic_result", "enteredValueText", r.valueString, r.valueString.slice(0, 40)));
  }
  const range = r.referenceRange?.[0];
  if (range) {
    const text = range.text ?? [range.low?.value !== undefined ? `${range.low.value}` : null, range.high?.value !== undefined ? `${range.high.value}` : null].filter(Boolean).join(" - ");
    if (text) out.push(draft(r, "diagnostic_result", "referenceText", text, text.slice(0, 120)));
  }
  return out;
}

function diagnosticReport(r: DiagnosticReportResource): ParsedCandidateDraft[] {
  const out: ParsedCandidateDraft[] = [];
  const title = conceptText(r.code);
  if (title) out.push(draft(r, "diagnostic_report", "title", title, title.slice(0, 160)));
  if (r.effectiveDateTime) out.push(draft(r, "diagnostic_report", "testedAt", r.effectiveDateTime, r.effectiveDateTime));
  if (r.issued) out.push(draft(r, "diagnostic_report", "reportedAt", r.issued, r.issued));
  const lab = r.performer?.find((p) => p.display)?.display;
  if (lab) out.push(draft(r, "diagnostic_report", "labName", lab, lab.slice(0, 160)));
  return out;
}

function practitioner(r: PractitionerResource): ParsedCandidateDraft[] {
  const out: ParsedCandidateDraft[] = [];
  const name = nameText(r.name?.[0]);
  if (name) out.push(draft(r, "practitioner", "displayName", name, name.slice(0, 120)));
  const speciality = conceptText(r.qualification?.[0]?.code);
  if (speciality) out.push(draft(r, "practitioner", "speciality", speciality, speciality.slice(0, 80)));
  // The council registration number is the MD identifier that is not the HPR id.
  const registration = r.identifier?.find((i) => i.system !== CODE_SYSTEMS.hprId && i.type?.coding?.some((c) => c.code === "MD"))?.value;
  if (registration) out.push(draft(r, "practitioner", "registrationNumber", registration, registration.slice(0, 40)));
  return out;
}

function organization(r: OrganizationResource): ParsedCandidateDraft[] {
  const out: ParsedCandidateDraft[] = [];
  if (r.name?.trim()) out.push(draft(r, "organization", "displayName", r.name, r.name.trim().slice(0, 160)));
  const city = r.address?.[0]?.city?.trim();
  if (city) out.push(draft(r, "organization", "city", city, city.slice(0, 80)));
  return out;
}

function composition(r: CompositionResource): ParsedCandidateDraft[] {
  const prescription = r.type?.coding?.some((c) => c.code === "440545006") || /prescription/i.test(r.type?.text ?? r.title ?? "");
  if (!prescription) return [];
  const date = dateOnly(r.date);
  return date ? [draft(r, "prescription", "prescribedAt", r.date, date)] : [];
}
