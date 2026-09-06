/**
 * Deterministic document classifier (docs_v2/09 §4): keyword and layout signals only, so the
 * baseline is explainable and runs in CI without any model. A model classifier can be added
 * behind the same `DocumentClassifier` interface.
 *
 * Safety rule (H-34): a discharge summary must never be classified as a prescription even when
 * it lists medicines — discharge signals win every tie, and a strong discharge signal beats a
 * prescription score outright. A misrouted discharge summary would propose *stopped* medicines
 * as current.
 */
import { round4 } from "../confidence.js";
import type { ClassificationResult, DocumentClassifier, DocumentInput, DocumentKind } from "../types.js";

export const DETERMINISTIC_CLASSIFIER_NAME = "deterministic-classifier";
export const DETERMINISTIC_CLASSIFIER_VERSION = "1.0.0";

interface Signal {
  id: string;
  kind: DocumentKind;
  weight: number;
  pattern: RegExp;
}

/**
 * Signals are matched against the whole document text (all pages) case-insensitively. Ids are
 * static strings — never page content — so they are safe to log and to feed metrics (§11).
 * Indian-English spellings (haemoglobin, centre, paediatric, Regn.) are included.
 */
const SIGNALS: readonly Signal[] = [
  // prescription
  { id: "rx", kind: "prescription", weight: 2, pattern: /(^|\s)(rx|℞)(\s|:|$)/im },
  { id: "prescription", kind: "prescription", weight: 2, pattern: /\bprescription\b/i },
  { id: "advice", kind: "prescription", weight: 1, pattern: /\badvi[cs]e\b/i },
  { id: "medicine-line", kind: "prescription", weight: 1, pattern: /(^|\s)(tab|tabs|cap|caps|syp|syr|inj|oint)\.?\s+[A-Za-z]/im },
  { id: "frequency-code", kind: "prescription", weight: 1, pattern: /\b(od|bd|tds|tid|qid|hs|sos)\b/i },
  { id: "slot-pattern", kind: "prescription", weight: 1, pattern: /\b\d(?:\.\d)?-\d(?:\.\d)?-\d(?:\.\d)?\b/ },
  { id: "registration", kind: "prescription", weight: 1, pattern: /\b(reg(n|istration)?\.?\s*no|mci|nmc)\b/i },

  // laboratory_report
  { id: "haemoglobin", kind: "laboratory_report", weight: 2, pattern: /\bha?emoglobin\b/i },
  { id: "reference-range", kind: "laboratory_report", weight: 2, pattern: /\b(reference|biological\s+ref(erence)?|normal)\s+(range|interval|value)s?\b/i },
  { id: "specimen", kind: "laboratory_report", weight: 2, pattern: /\bspecimen\b/i },
  { id: "lab-unit", kind: "laboratory_report", weight: 2, pattern: /\b(mg\/dl|g\/dl|mmol\/l|cells\/cumm|\/cumm|\/cmm|iu\/l|u\/l|µ?iu\/ml|ng\/ml|meq\/l)\b/i },
  { id: "lab-word", kind: "laboratory_report", weight: 1, pattern: /\b(pathology|laborator(y|ies)|lab\s+report|diagnostics?)\b/i },
  { id: "sample-collected", kind: "laboratory_report", weight: 1, pattern: /\b(sample|specimen)\s+(collected|received)\b/i },
  { id: "test-name", kind: "laboratory_report", weight: 1, pattern: /\b(test|investigation)\s+(name|report|result)s?\b/i },

  // imaging_report
  { id: "impression", kind: "imaging_report", weight: 2, pattern: /\bimpression\b/i },
  { id: "findings", kind: "imaging_report", weight: 2, pattern: /\bfindings\b/i },
  { id: "x-ray", kind: "imaging_report", weight: 2, pattern: /\b(x-?ray|radiograph|skiagram)\b/i },
  { id: "usg", kind: "imaging_report", weight: 2, pattern: /\b(usg|ultrasound|ultrasonography|sonography)\b/i },
  { id: "ct", kind: "imaging_report", weight: 2, pattern: /\b(ct|cect|hrct)\b(\s+scan)?/i },
  { id: "mri", kind: "imaging_report", weight: 2, pattern: /\bmri\b/i },
  { id: "radiology", kind: "imaging_report", weight: 1, pattern: /\bradiolog(y|ist)\b/i },
  { id: "echo", kind: "imaging_report", weight: 1, pattern: /\b(echocardiograph(y|ic)|2d\s*echo)\b/i },

  // discharge_summary
  { id: "discharge-summary", kind: "discharge_summary", weight: 3, pattern: /\bdischarge\s+summary\b/i },
  { id: "date-of-admission", kind: "discharge_summary", weight: 2, pattern: /\b(date\s+of\s+admission|admitted\s+on|d\.?o\.?a\.?\s*[:.])/i },
  { id: "date-of-discharge", kind: "discharge_summary", weight: 2, pattern: /\b(date\s+of\s+discharge|discharged\s+on|d\.?o\.?d\.?\s*[:.])/i },
  { id: "hospital-course", kind: "discharge_summary", weight: 2, pattern: /\b(hospital\s+course|course\s+in\s+(the\s+)?hospital)\b/i },
  { id: "condition-at-discharge", kind: "discharge_summary", weight: 2, pattern: /\bcondition\s+(at|on)\s+discharge\b/i },
  { id: "discharge-medication", kind: "discharge_summary", weight: 2, pattern: /\b(discharge\s+medic(ation|ine)s?|medic(ation|ine)s?\s+(on|at)\s+discharge)\b/i },

  // consultation_note
  { id: "consultation", kind: "consultation_note", weight: 2, pattern: /\bconsultation\b/i },
  { id: "chief-complaint", kind: "consultation_note", weight: 1, pattern: /\b(chief|presenting)\s+complaints?\b|\bc\/o\b/i },
  { id: "history", kind: "consultation_note", weight: 1, pattern: /\b(history\s+of\s+present(ing)?\s+illness|hopi|past\s+history)\b/i },
  { id: "examination", kind: "consultation_note", weight: 1, pattern: /\b(on\s+examination|o\/e|general\s+examination)\b/i },

  // vaccination_record
  { id: "vaccine", kind: "vaccination_record", weight: 2, pattern: /\bvaccin(e|es|ation|ated)\b/i },
  { id: "immunisation", kind: "vaccination_record", weight: 2, pattern: /\bimmuni[sz]ation\b/i },
  { id: "dose-number", kind: "vaccination_record", weight: 2, pattern: /\b(dose\s*[-:]?\s*[1-9]|[1-9](st|nd|rd|th)\s+dose|booster)\b/i },
  { id: "batch", kind: "vaccination_record", weight: 1, pattern: /\b(batch|lot)\s*(no\.?|number|#)?\s*[:.]?/i },
  { id: "next-due", kind: "vaccination_record", weight: 1, pattern: /\bnext\s+(dose\s+)?due\b/i },

  // referral
  { id: "referred-to", kind: "referral", weight: 3, pattern: /\breferred\s+to\b/i },
  { id: "referral", kind: "referral", weight: 2, pattern: /\breferral\b/i },
  { id: "opinion", kind: "referral", weight: 1, pattern: /\b(kindly\s+(see|examine)|for\s+(your\s+)?(expert\s+)?opinion|kind\s+attention)\b/i },

  // insurance
  { id: "policy", kind: "insurance", weight: 2, pattern: /\bpolicy\b/i },
  { id: "insured", kind: "insurance", weight: 2, pattern: /\binsured\b/i },
  { id: "sum-insured", kind: "insurance", weight: 2, pattern: /\bsum\s+(insured|assured)\b/i },
  { id: "mediclaim", kind: "insurance", weight: 2, pattern: /\bmediclaim\b/i },
  { id: "premium", kind: "insurance", weight: 1, pattern: /\bpremium\b/i },
  { id: "tpa", kind: "insurance", weight: 1, pattern: /\b(tpa|cashless|pre-?authori[sz]ation)\b/i },

  // invoice
  { id: "invoice", kind: "invoice", weight: 3, pattern: /\b(tax\s+)?invoice\b/i },
  { id: "gst", kind: "invoice", weight: 2, pattern: /\b(gst|gstin|cgst|sgst|igst)\b/i },
  { id: "total-amount", kind: "invoice", weight: 2, pattern: /\b(total\s+amount|grand\s+total|amount\s+payable|net\s+payable|net\s+amount)\b/i },
  { id: "bill", kind: "invoice", weight: 1, pattern: /\b(bill\s+no|receipt|cash\s+memo)\b/i },
  { id: "rupees", kind: "invoice", weight: 1, pattern: /₹|\brs\.?\s*\d/i },

  // medicine_packaging
  { id: "mfg", kind: "medicine_packaging", weight: 2, pattern: /\b(mfg|mfd|manufactured\s+by|marketed\s+by)\b/i },
  { id: "schedule-h", kind: "medicine_packaging", weight: 3, pattern: /\bschedule\s+h1?\b|to\s+be\s+sold\s+by\s+retail/i },
  { id: "storage", kind: "medicine_packaging", weight: 2, pattern: /\b(store\s+(in\s+a\s+cool|below|at|in\s+a\s+dry)|keep\s+out\s+of\s+reach|protect\s+from\s+light)\b/i },
  { id: "expiry", kind: "medicine_packaging", weight: 1, pattern: /\b(exp\.?|expiry|exp\.?\s*date)\s*[:.]?\s*\d/i },
  { id: "batch-no", kind: "medicine_packaging", weight: 1, pattern: /\b(b\.?\s*no\.?|batch\s+no\.?)\s*[:.]?\s*[A-Z0-9]/i },
  { id: "mrp", kind: "medicine_packaging", weight: 1, pattern: /\bm\.?r\.?p\.?\b/i },
  { id: "each-tablet-contains", kind: "medicine_packaging", weight: 2, pattern: /\b(each|every)\s+(film[- ]coated\s+|uncoated\s+)?(tablet|capsule|ml)\s+contains\b/i },
];

/**
 * Tie-break precedence. Discharge summary first (H-34), then kinds with distinctive vocabulary,
 * then the ones whose vocabulary overlaps everything else (consultation, prescription).
 */
const TIE_PRECEDENCE: readonly DocumentKind[] = [
  "discharge_summary",
  "laboratory_report",
  "imaging_report",
  "vaccination_record",
  "referral",
  "invoice",
  "insurance",
  "medicine_packaging",
  "consultation_note",
  "prescription",
  "other",
];

/** Score at or above this counts as strong evidence: a discharge score here beats prescription outright (H-34), and it disables the packaging layout heuristic. */
const STRONG_SCORE = 3;

const DATE_PATTERN = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/;
const STRENGTH_PATTERN = /\b\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|iu)\b/i;
const PACKAGING_MAX_CHARS = 200;
const PACKAGING_MAX_LINES = 8;

export interface ScoredKind {
  kind: DocumentKind;
  score: number;
  signals: string[];
}

export class DeterministicClassifier implements DocumentClassifier {
  readonly name = DETERMINISTIC_CLASSIFIER_NAME;
  readonly version = DETERMINISTIC_CLASSIFIER_VERSION;

  async classify(doc: DocumentInput): Promise<ClassificationResult> {
    return classifyDeterministically(doc);
  }
}

export function documentText(doc: DocumentInput): string {
  return doc.pages
    .map((p) => p.text ?? (p.words ? p.words.map((w) => w.text).join(" ") : ""))
    .join("\n")
    .trim();
}

/** Scores every kind; exported for tests and for the per-kind accuracy report (§4). */
export function scoreKinds(doc: DocumentInput): ScoredKind[] {
  const text = documentText(doc);
  const byKind = new Map<DocumentKind, ScoredKind>();
  const bump = (kind: DocumentKind, weight: number, id: string) => {
    const entry = byKind.get(kind) ?? { kind, score: 0, signals: [] };
    entry.score += weight;
    entry.signals.push(id);
    byKind.set(kind, entry);
  };

  if (text.length > 0) {
    for (const s of SIGNALS) {
      if (s.pattern.test(text)) bump(s.kind, s.weight, `keyword:${s.id}`);
    }
    // Layout heuristic: a strip/box/bottle photo is very short, names a strength, carries no dates.
    // It only fires when no other kind already has strong keyword evidence — a short discharge
    // summary or prescription is not a strip because it fits on one photo.
    const lineCount = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
    const strongestOther = Math.max(0, ...[...byKind.values()].filter((s) => s.kind !== "medicine_packaging").map((s) => s.score));
    if (
      text.length <= PACKAGING_MAX_CHARS &&
      lineCount <= PACKAGING_MAX_LINES &&
      STRENGTH_PATTERN.test(text) &&
      !DATE_PATTERN.test(text) &&
      strongestOther < STRONG_SCORE
    ) {
      bump("medicine_packaging", 2, "layout:short-with-strength-no-dates");
    }
  }

  return [...byKind.values()].sort(compareScored);
}

function compareScored(a: ScoredKind, b: ScoredKind): number {
  if (b.score !== a.score) return b.score - a.score;
  return TIE_PRECEDENCE.indexOf(a.kind) - TIE_PRECEDENCE.indexOf(b.kind);
}

export function classifyDeterministically(doc: DocumentInput): ClassificationResult {
  const scored = scoreKinds(doc);
  const top = scored[0];
  if (!top || top.score <= 0) {
    return { kind: "other", confidence: 0.2, classifiedBy: "deterministic", signals: ["no-signal"] };
  }

  let winner = top;
  const extraSignals: string[] = [];
  let competitors = scored;

  // H-34: a strong discharge signal beats prescription outright, whatever the medicine count says.
  // Prescription vocabulary is *expected* on a discharge summary, so once the rule fires it no
  // longer counts as competing evidence when the confidence is computed.
  const discharge = scored.find((s) => s.kind === "discharge_summary");
  if (winner.kind === "prescription" && discharge && discharge.score >= STRONG_SCORE) {
    winner = discharge;
    extraSignals.push("rule:H-34-discharge-over-prescription");
    competitors = scored.filter((s) => s.kind !== "prescription");
  }

  const runnerUp = competitors.find((s) => s.kind !== winner.kind);
  const runnerUpScore = runnerUp?.score ?? 0;
  const confidence = confidenceFor(winner.score, Math.min(runnerUpScore, winner.score));

  const competing = scored
    .filter((s) => s.kind !== winner.kind)
    .flatMap((s) => s.signals.map((id) => `${s.kind}:${id}`));

  return {
    kind: winner.kind,
    confidence,
    classifiedBy: "deterministic",
    signals: [...winner.signals, ...extraSignals, ...competing],
  };
}

/**
 * Confidence grows with the winning score (1 signal → 0.55, 2 → 0.70, 3 → 0.85, ≥4 → 0.97)
 * and shrinks with the runner-up's share (an exact tie halves it), so an ambiguous document
 * lands in the "please check" bucket rather than pre-selected.
 */
export function confidenceFor(topScore: number, runnerUpScore: number): number {
  if (topScore <= 0) return 0;
  const base = Math.min(0.97, 0.4 + 0.15 * topScore);
  const margin = 1 - 0.5 * (runnerUpScore / topScore);
  return round4(Math.max(0.05, base * margin));
}
