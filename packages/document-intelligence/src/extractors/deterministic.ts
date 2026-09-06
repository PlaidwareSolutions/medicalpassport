/**
 * Deterministic, rule-based clinical extractor (docs_v2/09 §2, §5, §7 "DeterministicExtractor
 * (exists, generalized)"). No AI, no guessing: every candidate cites the source line
 * (`detectedText`), its page, and — when word boxes exist — the box of the matched words.
 *
 * Generalizes the V1 worker's candidate-detection (brand / frequency / food) to the full V2
 * target catalogue. Dose quantity and lab interpretation are never produced here (targets.ts
 * NEVER_AUTO_PROPOSED); the pipeline would drop them anyway.
 */
import { combine } from "../confidence.js";
import {
  parseQuantityWithUnit,
  type FoodInstructionValue,
  type MedicationFormValue,
  type ProposableFrequencyCode,
} from "../targets.js";
import type {
  CatalogMatcher,
  ClinicalExtractor,
  DocumentKind,
  ExtractionCandidateDraft,
  ExtractionInput,
  ExtractorIdentity,
} from "../types.js";
import { findDates } from "./dates.js";
import { assembleLines, evidenceFor, type SourceLine, type Span } from "./lines.js";

export const DETERMINISTIC_EXTRACTOR: ExtractorIdentity = Object.freeze({
  name: "deterministic-extractor",
  version: "1.0.0",
});

/**
 * Word confidence assumed when a page has text but no word boxes. A PDF text layer is exact
 * (1.0); plain OCR text without word data is treated as good-but-unverified (0.9).
 */
export const DEFAULT_TEXT_CONFIDENCE = Object.freeze({ pdfTextLayer: 1, ocrText: 0.9 });

/** Rule match qualities (the V1 worker values are kept where the rule is the same). */
export const MATCH_QUALITY = Object.freeze({
  brandCatalog: 0.9,
  frequencyPattern: 0.85,
  frequencyAbbreviation: 0.75,
  foodInstruction: 0.75,
  durationExplicit: 0.85,
  durationBare: 0.7,
  strength: 0.85,
  form: 0.8,
  dateLabelled: 0.95,
  dateBare: 0.6,
  followUp: 0.85,
  practitionerName: 0.8,
  practitionerNameQualified: 0.85,
  speciality: 0.7,
  registrationNumber: 0.85,
  organizationHeader: 0.8,
  organizationBody: 0.7,
  labRow: 0.85,
  labReference: 0.8,
  encounterDate: 0.9,
  reportDate: 0.9,
});

const FREQUENCY_ABBREVIATIONS: Record<string, ProposableFrequencyCode> = {
  od: "OD",
  bd: "BD",
  tds: "TDS",
  tid: "TDS",
  qid: "QID",
  sos: "SOS",
  hs: "HS",
};

const FOOD_KEYWORDS: Array<{ regex: RegExp; value: FoodInstructionValue }> = [
  { regex: /\b(before\s+(food|meals?|breakfast)|empty\s+stomach)\b/i, value: "before" },
  { regex: /\bwith\s+(food|meals?)\b/i, value: "with" },
  { regex: /\bafter\s+(food|meals?|breakfast|lunch|dinner)\b/i, value: "after" },
  { regex: /\b(at\s+bed\s*time|bedtime)\b/i, value: "bedtime" },
];

const FORM_PREFIX =
  /^\s*(tab|tabs|tablet|cap|caps|capsule|syp|syr|syrup|susp|suspension|inj|injection|oint|ointment|cream|gel|drops?|inh|inhaler|sachet|powder|lotion)\.?\s+(?=\S)/i;

const FORM_BY_PREFIX: Record<string, MedicationFormValue> = {
  tab: "tablet", tabs: "tablet", tablet: "tablet",
  cap: "capsule", caps: "capsule", capsule: "capsule",
  syp: "syrup", syr: "syrup", syrup: "syrup",
  susp: "suspension", suspension: "suspension",
  inj: "injection", injection: "injection",
  oint: "ointment", ointment: "ointment",
  cream: "cream",
  gel: "gel",
  drop: "drops", drops: "drops",
  inh: "inhaler", inhaler: "inhaler",
  sachet: "sachet",
  powder: "powder",
  lotion: "lotion",
};

const STRENGTH = /\b(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|g|ml|iu|%)\b(?!\s*\/)/i;
const SLOT_PATTERN = /\b(\d(?:\.\d)?-\d(?:\.\d)?-\d(?:\.\d)?)\b/;
const ABBREVIATION = /\b(od|bd|tds|tid|qid|sos|hs)\b/i;
const DURATION_EXPLICIT = /\b(?:for|x|×)\s*(\d{1,3})\s*(days?|d|weeks?|wks?|w)\b/i;
const DURATION_BARE = /\b(\d{1,3})\s*(days?)\b/i;

const DATE_LABEL = /^\s*(date|dt|dated|date\s+of\s+(issue|visit|consultation|prescription))\b/i;
const DATE_INLINE_LABEL = /\b(date|dt|dated)\s*[:.-]/i;
const DATE_EXCLUDE = /\b(dob|d\.o\.b|birth|valid|follow|review|next|admission|admitted|discharge|exp|mfd|mfg|collected|received|reported|report|due|printed|tested|test)\b/i;
const FOLLOW_UP = /\b(follow[\s-]?up|review|next\s+visit)\b/i;

const DOCTOR = /\bDr\.?\s*([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})/;
const QUALIFICATIONS = /\b(mbbs|md|ms|dm|mch|dnb|frcs|mrcp|mrcog|dgo|dch|bds|mds|bams|bhms|phd|da|fcps|dorth|dpm|facc|fics)\b/i;
const SPECIALITY =
  /\b(general\s+physician|consultant\s+physician|physician|cardiologist|paediatrician|pediatrician|gynaecologist|gynecologist|obstetrician|orthopaedic(?:\s+surgeon)?|orthopedic(?:\s+surgeon)?|dermatologist|neurologist|neurosurgeon|ent\s+surgeon|general\s+surgeon|surgeon|diabetologist|endocrinologist|nephrologist|urologist|psychiatrist|ophthalmologist|dentist|radiologist|pathologist|pulmonologist|gastroenterologist|oncologist|rheumatologist|anaesthetist|anesthesiologist|physiotherapist)\b/i;
const REGISTRATION =
  /\b(?:reg(?:n|istration)?\.?\s*(?:no\.?|number|#)?|mci\s*(?:no\.?|reg\.?)?|nmc\s*(?:no\.?|reg\.?)?|[A-Z]{1,4}MC\s*(?:no\.?|reg\.?)?|medical\s+council(?:\s+of\s+\w+)?\s*(?:no\.?|reg\.?)?)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/-]{2,24})\b/i;

const ORGANIZATION =
  /\b(clinic|hospitals?|centre|center|labs?|laborator(?:y|ies)|diagnostics?|nursing\s+home|polyclinic|medical\s+college|institute|health\s?care|pharmacy|multispecialit(?:y|ies))\b/i;
const ORGANIZATION_EXCLUDE = /\b(referred|admitted|discharged|visit|follow)\b/i;

const ADMISSION = /\b(date\s+of\s+admission|admitted\s+on|d\.?o\.?a\.?)\s*[:.-]?/i;
const DISCHARGE = /\b(date\s+of\s+discharge|discharged\s+on|d\.?o\.?d\.?)\s*[:.-]?/i;
const COLLECTED = /\b(sample|specimen)\s+(collected|received|collection)\b|\bcollected\s+(on|at|date)\b/i;
const REPORTED = /\b(reported\s+(on|at)|report(ed)?\s+date|date\s+of\s+report|reporting\s+date)\b/i;
const TESTED = /\b(tested\s+on|test(ed)?\s+date|date\s+of\s+test)\b/i;

/** Lab row: `<label> [comparator] <number> [unit] [reference]`. */
const LAB_ROW =
  /^(?<label>[A-Za-z][A-Za-z0-9 .,()'/%-]{1,60}?)\s*[:\-]?\s+(?<comp>[<>]=?)?\s*(?<value>\d+(?:[.,]\d+)*)\s*(?<unit>%|[A-Za-zµ][A-Za-z0-9µ/^.]*(?:\/[A-Za-zµ0-9^.]+)?)?(?<rest>\s.*)?$/;
const LAB_UNITS = new Set([
  "%", "g/dl", "mg/dl", "mmol/l", "µmol/l", "umol/l", "ng/ml", "pg/ml", "iu/l", "u/l", "iu/ml", "µiu/ml", "uiu/ml", "miu/l",
  "miu/ml", "meq/l", "cells/cumm", "/cumm", "/cmm", "/µl", "/ul", "x10^3/µl", "10^3/µl", "10^9/l", "10^12/l", "fl", "pg",
  "mm/hr", "mm/1sthr", "sec", "seconds", "ratio", "g/l", "mg/l", "µg/dl", "ug/dl", "ng/dl", "pmol/l", "nmol/l", "mosm/kg",
  "ml/min", "ml/min/1.73m2", "mmhg", "kg", "cm", "bpm", "/hpf", "cells/µl", "cells/ul", "lakhs/cumm", "lakh/cumm",
  "million/cumm", "millions/cumm", "thou/cumm", "thou/µl", "mg/24hr", "g/24hr", "ng/l", "pg/dl", "mcg/dl", "u/ml",
]);
const REFERENCE = /(\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?|[<>]\s*=?\s*\d+(?:\.\d+)?|\bref(?:erence)?\b|\bnormal\b)/i;
const LAB_LABEL_EXCLUDE =
  /^(tab|tabs|cap|caps|syp|syr|inj|oint|dr|date|age|sex|phone|tel|mob|mobile|pin|reg|regn|invoice|bill|total\s+amount|grand\s+total|amount|rs|mrp|page|patient|name|ref|sample|specimen|report|lab|id|uhid|no)\b/i;

type LineRule = (ctx: LineContext) => void;

interface LineContext {
  line: SourceLine;
  previous?: SourceLine;
  kind: DocumentKind;
  catalogMatcher?: CatalogMatcher;
}

interface Proposal {
  entity: string;
  field: string;
  value: unknown;
  quality: number;
  span?: Span;
  groupKey?: string;
}

/** One proposal slot per document for these entities; medication and diagnostic_result rows are many. */
const SINGLE_SLOT_ENTITIES = new Set(["prescription", "practitioner", "organization", "diagnostic_report", "encounter"]);

export class DeterministicExtractor implements ClinicalExtractor {
  readonly identity = DETERMINISTIC_EXTRACTOR;

  async extract(input: ExtractionInput): Promise<ExtractionCandidateDraft[]> {
    return extractDeterministically(input);
  }
}

export function extractDeterministically(input: ExtractionInput): ExtractionCandidateDraft[] {
  const kind: DocumentKind = input.classification?.kind ?? input.document.kind ?? "other";
  const defaultConfidence = input.document.pdfTextLayer ? DEFAULT_TEXT_CONFIDENCE.pdfTextLayer : DEFAULT_TEXT_CONFIDENCE.ocrText;
  // docs_v2/16 §3 defect 5: a page the engine scored as a whole lends that score to every
  // line no word box backs, instead of the fixed 0.9 — so a blurry photo cannot produce
  // candidates that look as sure as a crisp one.
  const pageConfidence = new Map<number, number>();
  for (const page of input.document.pages) {
    if (!input.document.pdfTextLayer && typeof page.confidence === "number") pageConfidence.set(page.pageNumber, page.confidence);
  }
  const lines = assembleLines(input.document);
  const drafts: ExtractionCandidateDraft[] = [];

  const emit = (line: SourceLine, p: Proposal) => {
    const evidence = evidenceFor(line, p.span);
    const draft: ExtractionCandidateDraft = {
      targetEntity: p.entity,
      targetField: p.field,
      pageNumber: line.pageNumber,
      detectedText: line.text,
      proposedValue: p.value,
      confidence: combine(evidence.wordConfidence ?? pageConfidence.get(line.pageNumber) ?? defaultConfidence, p.quality),
      extractor: DETERMINISTIC_EXTRACTOR,
    };
    if (evidence.boundingBox) draft.boundingBox = evidence.boundingBox;
    if (p.groupKey) draft.groupKey = p.groupKey;
    drafts.push(draft);
  };

  const rules = rulesFor(kind, emit);
  let lastMedicationLine: SourceLine | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const previous = lastMedicationLine && isAdjacent(lastMedicationLine, line) ? lastMedicationLine : undefined;
    const ctx: LineContext = { line, kind, ...(previous ? { previous } : {}) };
    if (input.catalogMatcher) ctx.catalogMatcher = input.catalogMatcher;
    for (const rule of rules) rule(ctx);
    if (isMedicationLine(line, input.catalogMatcher)) lastMedicationLine = line;
  }

  return keepSingleSlots(drafts);
}

function isAdjacent(a: SourceLine, b: SourceLine): boolean {
  return a.pageNumber === b.pageNumber && b.index === a.index + 1;
}

type Emit = (line: SourceLine, p: Proposal) => void;

function rulesFor(kind: DocumentKind, emit: Emit): LineRule[] {
  const rules: LineRule[] = [];
  const practitionerAndOrg = [practitionerRule(emit), organizationRule(emit)];
  switch (kind) {
    case "prescription":
    case "consultation_note":
      rules.push(prescribedAtRule(emit), followUpRule(emit), ...practitionerAndOrg, medicationRule(emit));
      break;
    case "discharge_summary":
      // Medicines on a discharge summary are extracted for the *transition* workflow, never
      // "add medicines" (H-34) — the routing decision is the caller's, the candidates are the same.
      rules.push(encounterDatesRule(emit), ...practitionerAndOrg, medicationRule(emit));
      break;
    case "laboratory_report":
      rules.push(reportDatesRule(emit), ...practitionerAndOrg, labNameRule(emit), labRowRule(emit));
      break;
    case "imaging_report":
      rules.push(reportDatesRule(emit), ...practitionerAndOrg);
      break;
    case "other":
      rules.push(prescribedAtRule(emit), followUpRule(emit), ...practitionerAndOrg, medicationRule(emit), labRowRule(emit));
      break;
    default:
      // vaccination_record, referral, insurance, invoice, medicine_packaging: no clinical
      // candidates from the deterministic extractor yet — the document is still kept and shown.
      break;
  }
  return rules;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function prescribedAtRule(emit: Emit): LineRule {
  return ({ line }) => {
    if (line.pageNumber !== 1) return;
    const labelled = DATE_LABEL.test(line.text) || DATE_INLINE_LABEL.test(line.text);
    if (!labelled && DATE_EXCLUDE.test(line.text)) return;
    const date = findDates(line.text)[0];
    if (!date) return;
    emit(line, {
      entity: "prescription",
      field: "prescribedAt",
      value: date.iso,
      quality: labelled ? MATCH_QUALITY.dateLabelled : MATCH_QUALITY.dateBare,
      span: date,
    });
  };
}

function followUpRule(emit: Emit): LineRule {
  return ({ line }) => {
    if (!FOLLOW_UP.test(line.text)) return;
    const date = findDates(line.text)[0];
    if (!date) return;
    emit(line, { entity: "prescription", field: "followUpOn", value: date.iso, quality: MATCH_QUALITY.followUp, span: date });
  };
}

function encounterDatesRule(emit: Emit): LineRule {
  return ({ line }) => {
    const admission = ADMISSION.exec(line.text);
    const discharge = DISCHARGE.exec(line.text);
    const dates = findDates(line.text);
    if (admission) {
      const date = dates.find((d) => d.start >= admission.index) ?? dates[0];
      if (date) emit(line, { entity: "encounter", field: "startedAt", value: date.iso, quality: MATCH_QUALITY.encounterDate, span: date });
    }
    if (discharge) {
      const date = dates.find((d) => d.start >= discharge.index) ?? dates[dates.length - 1];
      if (date) emit(line, { entity: "encounter", field: "endedAt", value: date.iso, quality: MATCH_QUALITY.encounterDate, span: date });
    }
    if (admission || discharge) {
      emit(line, { entity: "encounter", field: "kind", value: "inpatient", quality: MATCH_QUALITY.encounterDate });
    }
  };
}

function reportDatesRule(emit: Emit): LineRule {
  return ({ line }) => {
    const dates = findDates(line.text);
    if (dates.length === 0) return;
    const targets: Array<[RegExp, string]> = [
      [COLLECTED, "specimenCollectedAt"],
      [REPORTED, "reportedAt"],
      [TESTED, "testedAt"],
    ];
    for (const [re, field] of targets) {
      const label = re.exec(line.text);
      if (!label) continue;
      // The date that follows its label; a line with several labels yields one date each.
      const date = dates.find((d) => d.start >= label.index) ?? dates[0];
      if (date) emit(line, { entity: "diagnostic_report", field, value: date.iso, quality: MATCH_QUALITY.reportDate, span: date });
    }
  };
}

// ---------------------------------------------------------------------------
// Practitioner / organization
// ---------------------------------------------------------------------------

function practitionerRule(emit: Emit): LineRule {
  return ({ line }) => {
    const doctor = DOCTOR.exec(line.text);
    if (doctor && doctor[1]) {
      const name = cleanName(doctor[1]);
      if (name.length >= 2) {
        const start = doctor.index;
        const end = doctor.index + doctor[0].length;
        emit(line, {
          entity: "practitioner",
          field: "displayName",
          value: name,
          quality: QUALIFICATIONS.test(line.text) ? MATCH_QUALITY.practitionerNameQualified : MATCH_QUALITY.practitionerName,
          span: { start, end },
        });
      }
    }
    const speciality = SPECIALITY.exec(line.text);
    if (speciality && (doctor || /\b(consultant|specialist)\b/i.test(line.text))) {
      emit(line, {
        entity: "practitioner",
        field: "speciality",
        value: titleCase(speciality[0]),
        quality: MATCH_QUALITY.speciality,
        span: { start: speciality.index, end: speciality.index + speciality[0].length },
      });
    }
    const reg = REGISTRATION.exec(line.text);
    if (reg && reg[1] && /\d/.test(reg[1])) {
      emit(line, {
        entity: "practitioner",
        field: "registrationNumber",
        value: reg[1].toUpperCase(),
        quality: MATCH_QUALITY.registrationNumber,
        span: { start: reg.index, end: reg.index + reg[0].length },
      });
    }
  };
}

function cleanName(raw: string): string {
  const words = raw.trim().split(/\s+/);
  while (words.length > 0) {
    const last = words[words.length - 1] ?? "";
    if (QUALIFICATIONS.test(last.replace(/[.,()]/g, ""))) words.pop();
    else break;
  }
  return words.join(" ").replace(/[,.]+$/, "").trim();
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(" ");
}

function organizationRule(emit: Emit): LineRule {
  return ({ line }) => {
    if (!ORGANIZATION.test(line.text) || ORGANIZATION_EXCLUDE.test(line.text)) return;
    if (LAB_ROW.test(line.text) && !/[A-Za-z]\s*$/.test(line.text)) return;
    const value = line.text.replace(/\s{2,}/g, " ").slice(0, 160);
    const header = line.pageNumber === 1 && line.index < 4;
    emit(line, {
      entity: "organization",
      field: "displayName",
      value,
      quality: header ? MATCH_QUALITY.organizationHeader : MATCH_QUALITY.organizationBody,
    });
  };
}

function labNameRule(emit: Emit): LineRule {
  return ({ line }) => {
    if (!/\b(labs?|laborator(?:y|ies)|diagnostics?|pathology)\b/i.test(line.text) || ORGANIZATION_EXCLUDE.test(line.text)) return;
    if (LAB_ROW.test(line.text)) return;
    const header = line.pageNumber === 1 && line.index < 4;
    emit(line, {
      entity: "diagnostic_report",
      field: "labName",
      value: line.text.replace(/\s{2,}/g, " ").slice(0, 160),
      quality: header ? MATCH_QUALITY.organizationHeader : MATCH_QUALITY.organizationBody,
    });
  };
}

// ---------------------------------------------------------------------------
// Medication lines
// ---------------------------------------------------------------------------

export function isMedicationLine(line: SourceLine, catalogMatcher?: CatalogMatcher): boolean {
  if (FORM_PREFIX.test(line.text)) return true;
  if (catalogMatcher && catalogMatcher(line.text)) return true;
  return STRENGTH.test(line.text) && (SLOT_PATTERN.test(line.text) || ABBREVIATION.test(line.text));
}

function medicationRule(emit: Emit): LineRule {
  return ({ line, previous, catalogMatcher }) => {
    const text = line.text;
    const own = isMedicationLine(line, catalogMatcher);
    // A line right after a medicine line carrying only dosing words ("1-0-1 after food x 5 days")
    // belongs to that medicine.
    const continuation = !own && previous !== undefined;
    if (!own && !continuation) return;
    const anchor = own ? line : (previous as SourceLine);
    const groupKey = `medication:p${anchor.pageNumber}:l${anchor.index}`;
    const med = (field: string, value: unknown, quality: number, span?: Span) =>
      emit(line, { entity: "medication", field, value, quality, groupKey, ...(span ? { span } : {}) });

    if (own) {
      const match = catalogMatcher ? catalogMatcher(text) : null;
      if (match) {
        const at = text.toLowerCase().indexOf(match.matchedText.toLowerCase());
        med(
          "brandName",
          { productId: match.productId, label: match.label },
          match.quality ?? MATCH_QUALITY.brandCatalog,
          at >= 0 ? { start: at, end: at + match.matchedText.length } : undefined,
        );
      }
      const form = FORM_PREFIX.exec(text);
      const formValue = form && form[1] ? FORM_BY_PREFIX[form[1].toLowerCase()] : undefined;
      if (form && formValue) med("form", formValue, MATCH_QUALITY.form, { start: form.index, end: form.index + form[1]!.length });

      const strength = STRENGTH.exec(text);
      if (strength) {
        const parsed = parseQuantityWithUnit(`${strength[1]} ${strength[2]}`);
        if (parsed) med("strengthLabel", parsed, MATCH_QUALITY.strength, { start: strength.index, end: strength.index + strength[0].length });
      }
    }

    const pattern = SLOT_PATTERN.exec(text);
    if (pattern && pattern[1] && isValidSlotPattern(pattern[1])) {
      med("frequency", { code: "PATTERN", pattern: pattern[1] }, MATCH_QUALITY.frequencyPattern, {
        start: pattern.index,
        end: pattern.index + pattern[0].length,
      });
    } else {
      const abbrev = ABBREVIATION.exec(text);
      const code = abbrev && abbrev[1] ? FREQUENCY_ABBREVIATIONS[abbrev[1].toLowerCase()] : undefined;
      if (abbrev && code) {
        med("frequency", { code }, MATCH_QUALITY.frequencyAbbreviation, { start: abbrev.index, end: abbrev.index + abbrev[0].length });
      }
    }

    for (const { regex, value } of FOOD_KEYWORDS) {
      const food = regex.exec(text);
      if (food) {
        med("foodInstruction", value, MATCH_QUALITY.foodInstruction, { start: food.index, end: food.index + food[0].length });
        break;
      }
    }

    const explicit = DURATION_EXPLICIT.exec(text);
    const bare = explicit ? null : DURATION_BARE.exec(text);
    const duration = explicit ?? bare;
    if (duration && duration[1] && duration[2]) {
      const n = Number(duration[1]);
      const unit = duration[2].toLowerCase();
      const days = unit.startsWith("w") ? n * 7 : n;
      if (days >= 1 && days <= 365) {
        med("durationDays", days, explicit ? MATCH_QUALITY.durationExplicit : MATCH_QUALITY.durationBare, {
          start: duration.index,
          end: duration.index + duration[0].length,
        });
      }
    }
  };
}

/** Same acceptance as @medpass/medication-terminology parsePattern: 3 slots, each <= 10, not all zero. */
export function isValidSlotPattern(pattern: string): boolean {
  const m = /^(\d(?:\.\d)?)-(\d(?:\.\d)?)-(\d(?:\.\d)?)$/.exec(pattern);
  if (!m) return false;
  const nums = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (nums.some((n) => Number.isNaN(n) || n > 10)) return false;
  return nums.some((n) => n > 0);
}

// ---------------------------------------------------------------------------
// Lab rows
// ---------------------------------------------------------------------------

export interface ParsedLabRow {
  label: string;
  comparator?: "<" | "<=" | ">" | ">=";
  value: string;
  unit?: string;
  reference?: string;
  spans: { label: Span; comparator?: Span; value: Span; unit?: Span; reference?: Span };
}

export function parseLabRow(text: string): ParsedLabRow | null {
  const m = LAB_ROW.exec(text);
  const g = m?.groups;
  if (!m || !g || !g.label || !g.value) return null;
  const label = g.label.trim().replace(/[:\-]+$/, "").trim();
  if (label.length < 2 || !/[A-Za-z]{2}/.test(label) || LAB_LABEL_EXCLUDE.test(label)) return null;
  if (/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(text)) return null; // a dated line, not a result row

  const unitRaw = g.unit ?? "";
  const unitKey = unitRaw.toLowerCase().replace(/\s+/g, "");
  const unitKnown = unitRaw.length > 0 && (LAB_UNITS.has(unitKey) || (unitRaw.includes("/") && /[a-zµ]/i.test(unitRaw)));
  const rest = (g.rest ?? "").trim();
  const refMatch = REFERENCE.exec(rest);
  if (!unitKnown && !refMatch) return null;

  const labelStart = m.index + m[0].indexOf(g.label);
  const valueStart = text.indexOf(g.value, labelStart + g.label.length);
  const row: ParsedLabRow = {
    label,
    value: g.value,
    spans: { label: { start: labelStart, end: labelStart + label.length }, value: { start: valueStart, end: valueStart + g.value.length } },
  };
  if (g.comp) {
    const compStart = text.indexOf(g.comp, labelStart + g.label.length);
    row.comparator = g.comp as ParsedLabRow["comparator"];
    row.spans.comparator = { start: compStart, end: compStart + g.comp.length };
  }
  if (unitKnown) {
    const unitStart = text.indexOf(unitRaw, valueStart + g.value.length);
    row.unit = unitRaw;
    row.spans.unit = { start: unitStart, end: unitStart + unitRaw.length };
  }
  if (refMatch) {
    const restStart = text.length - (g.rest ?? "").length + ((g.rest ?? "").length - (g.rest ?? "").trimStart().length);
    const reference = rest.replace(/^[\s(\[]+|[\s)\]]+$/g, "").replace(/^(ref(?:erence)?\.?\s*(range)?\s*[:.-]?\s*)/i, "").trim();
    if (reference.length > 0) {
      row.reference = reference;
      row.spans.reference = { start: restStart, end: text.length };
    }
  }
  return row;
}

function labRowRule(emit: Emit): LineRule {
  return ({ line }) => {
    if (FORM_PREFIX.test(line.text)) return;
    const row = parseLabRow(line.text);
    if (!row) return;
    const groupKey = `diagnostic_result:p${line.pageNumber}:l${line.index}`;
    const result = (field: string, value: unknown, quality: number, span: Span) =>
      emit(line, { entity: "diagnostic_result", field, value, quality, span, groupKey });
    result("analyteLabelText", row.label, MATCH_QUALITY.labRow, row.spans.label);
    result("enteredValueText", row.value, MATCH_QUALITY.labRow, row.spans.value);
    if (row.unit && row.spans.unit) result("enteredUnit", row.unit, MATCH_QUALITY.labRow, row.spans.unit);
    if (row.comparator && row.spans.comparator) result("comparator", row.comparator, MATCH_QUALITY.labRow, row.spans.comparator);
    if (row.reference && row.spans.reference) result("referenceText", row.reference, MATCH_QUALITY.labReference, row.spans.reference);
    // `interpretation` is deliberately never emitted, even when the lab printed H/L flags.
  };
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

function keepSingleSlots(drafts: ExtractionCandidateDraft[]): ExtractionCandidateDraft[] {
  const best = new Map<string, ExtractionCandidateDraft>();
  const out: ExtractionCandidateDraft[] = [];
  for (const d of drafts) {
    if (!SINGLE_SLOT_ENTITIES.has(d.targetEntity)) {
      out.push(d);
      continue;
    }
    const key = `${d.targetEntity}.${d.targetField}`;
    const existing = best.get(key);
    if (!existing || d.confidence > existing.confidence) best.set(key, d);
  }
  return [...out, ...best.values()];
}
