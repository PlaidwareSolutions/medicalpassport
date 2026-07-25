/**
 * Vetted external source adapter for clinical content enrichment (docs/13,
 * docs/34 Gate 6/OD-6). Server-only — used by apps/worker exclusively, never
 * a frontend, since this makes live network calls (unlike
 * packages/clinical-rules, which is a browser-safe presentation-constants
 * scaffold also imported by apps/patient-web today).
 *
 * Source: openFDA/DailyMed structured product labels (public domain, free,
 * no auth required for moderate volume — see OPENFDA_API_KEY below).
 * Everything returned here is a *draft candidate* only; nothing from this
 * module is ever shown to a patient without a human clinical reviewer's
 * approval first.
 *
 * Two extraction strategies, by kind:
 *  - education/storage/warning_symptoms: a clean, whole-SPL-section grab
 *    (indications_and_usage/how_supplied/warnings_and_cautions) — the same
 *    reliability as the original pipeline.
 *  - food_alcohol/missed_dose: openFDA has no dedicated field for either —
 *    live-checked, this information (when present at all) is buried as a
 *    fragment inside the much longer information_for_patients/
 *    drug_interactions free text. Extracted via a bounded keyword-window
 *    search instead of a whole-section grab, and always flagged
 *    `lowConfidence: true` so an admin reviewer knows to scrutinize it
 *    harder — this is a materially weaker guarantee than the other three
 *    kinds, not hidden as if it were equally reliable.
 */

const OPENFDA_BASE_URL = "https://api.fda.gov/drug/label.json";

export type ClinicalContentKind = "education" | "storage" | "warning_symptoms" | "food_alcohol" | "missed_dose";

interface OpenFdaLabelResult {
  id?: string;
  set_id?: string;
  effective_time?: string;
  indications_and_usage?: string[];
  how_supplied?: string[];
  warnings_and_cautions?: string[];
  information_for_patients?: string[];
  drug_interactions?: string[];
  openfda?: {
    generic_name?: string[];
    substance_name?: string[];
    brand_name?: string[];
  };
}

interface OpenFdaResponse {
  results?: OpenFdaLabelResult[];
}

export interface ClinicalContentResult {
  text: string;
  sourceCitation: string;
  sourceUrl: string;
  lowConfidence: boolean;
}

function isCombinationProduct(result: OpenFdaLabelResult): boolean {
  const substances = result.openfda?.substance_name?.length ? result.openfda.substance_name : (result.openfda?.generic_name ?? []);
  return substances.length > 1;
}

function formatEffectiveDate(effectiveTime: string | undefined): string {
  if (!effectiveTime || effectiveTime.length < 8) return "unknown date";
  return `${effectiveTime.slice(0, 4)}-${effectiveTime.slice(4, 6)}-${effectiveTime.slice(6, 8)}`;
}

function buildCitation(result: OpenFdaLabelResult, matchedName: string, section: string): string {
  const setId = result.set_id ?? result.id ?? "unknown";
  const fetchedOn = new Date().toISOString().slice(0, 10);
  return `openFDA/DailyMed structured product label (${section}), set id ${setId}, matched on "${matchedName}", label effective ${formatEffectiveDate(result.effective_time)}, fetched ${fetchedOn}`;
}

function buildSourceUrl(result: OpenFdaLabelResult): string {
  const setId = result.set_id ?? result.id;
  return setId ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${setId}` : "https://open.fda.gov/apis/drug/label/";
}

/**
 * Pure — filters/ranks a raw openFDA response with no network I/O, so this
 * is unit-testable against fixture JSON without ever hitting the real API
 * in CI. Rejects combination-product labels (a naive tokenized generic-name
 * search returns those too — confirmed live), records with no `openfda`
 * block at all, and de-dupes by `set_id`; prefers the most recently
 * effective label among what's left. Returns null when nothing confident
 * survives filtering.
 */
export function pickBestLabel(response: OpenFdaResponse): OpenFdaLabelResult | null {
  const seen = new Set<string>();
  const candidates = (response.results ?? []).filter((r) => {
    if (!r.openfda) return false;
    if (isCombinationProduct(r)) return false;
    const key = r.set_id ?? r.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => (b.effective_time ?? "").localeCompare(a.effective_time ?? ""));
  return candidates[0]!;
}

/**
 * Bounded keyword-window extraction for kinds with no dedicated SPL field:
 * finds the earliest keyword match, then widens to whole-sentence
 * boundaries (nearest ". " before/after) so the excerpt never starts or
 * ends mid-sentence. Returns null when no keyword appears anywhere —
 * never fabricates a fragment out of unrelated text.
 */
function extractKeywordWindow(text: string | undefined, keywords: string[], windowChars = 400): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  let hitIndex = -1;
  for (const kw of keywords) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx !== -1 && (hitIndex === -1 || idx < hitIndex)) hitIndex = idx;
  }
  if (hitIndex === -1) return null;

  let start = Math.max(0, hitIndex - windowChars / 2);
  const roughEnd = Math.min(text.length, hitIndex + windowChars);

  const sentenceStart = text.lastIndexOf(". ", hitIndex);
  if (sentenceStart !== -1 && sentenceStart >= start) start = sentenceStart + 2;

  let end = roughEnd;
  const sentenceEnd = text.indexOf(". ", roughEnd);
  if (sentenceEnd !== -1) end = sentenceEnd + 1;

  const excerpt = text.slice(start, end).trim();
  return excerpt.length > 0 ? excerpt : null;
}

const FOOD_ALCOHOL_KEYWORDS = ["alcohol", "grapefruit"];
// Real FDA label phrasing varies more than a narrow "missed dose" match
// would catch — e.g. Warfarin's actual label reads "If the prescribed dose
// of warfarin sodium is missed..." (verified live), not "missed dose".
const MISSED_DOSE_KEYWORDS = ["missed dose", "miss a dose", "dose is missed", "forget to take", "forgot to take", "skip a dose", "skipped dose"];

interface Extraction {
  text: string;
  section: string;
  lowConfidence: boolean;
}

/** Pure — given a chosen label, extracts the requested kind's text (or null). */
export function extractForKind(label: OpenFdaLabelResult, kind: ClinicalContentKind): Extraction | null {
  switch (kind) {
    case "education": {
      const text = label.indications_and_usage?.[0]?.trim();
      return text ? { text, section: "indications_and_usage", lowConfidence: false } : null;
    }
    case "storage": {
      const text = label.how_supplied?.[0]?.trim();
      return text ? { text, section: "how_supplied", lowConfidence: false } : null;
    }
    case "warning_symptoms": {
      const text = label.warnings_and_cautions?.[0]?.trim();
      return text ? { text, section: "warnings_and_cautions", lowConfidence: false } : null;
    }
    case "food_alcohol": {
      const fromPatientInfo = extractKeywordWindow(label.information_for_patients?.[0], FOOD_ALCOHOL_KEYWORDS);
      if (fromPatientInfo) return { text: fromPatientInfo, section: "information_for_patients", lowConfidence: true };
      const fromInteractions = extractKeywordWindow(label.drug_interactions?.[0], FOOD_ALCOHOL_KEYWORDS);
      return fromInteractions ? { text: fromInteractions, section: "drug_interactions", lowConfidence: true } : null;
    }
    case "missed_dose": {
      const text = extractKeywordWindow(label.information_for_patients?.[0], MISSED_DOSE_KEYWORDS);
      return text ? { text, section: "information_for_patients", lowConfidence: true } : null;
    }
  }
}

async function queryOpenFda(name: string, apiKey: string | undefined): Promise<OpenFdaResponse> {
  const params = new URLSearchParams({
    search: `openfda.generic_name:"${name}" AND _exists_:indications_and_usage`,
    limit: "25",
  });
  if (apiKey) params.set("api_key", apiKey);

  const res = await fetch(`${OPENFDA_BASE_URL}?${params.toString()}`);
  // openFDA returns a plain 404 (not an empty 200) for zero matches — that's
  // "no data", not a failure, and must not be thrown.
  if (res.status === 404) return { results: [] };
  if (!res.ok) throw new Error(`openfda_http_${res.status}`);
  return (await res.json()) as OpenFdaResponse;
}

/**
 * Fetches a candidate for the given content kind for one generic
 * ingredient. Tries `name`, then each synonym in turn — this is what
 * bridges the catalog's INN naming (e.g. "Paracetamol") to openFDA's US
 * generic names (e.g. "Acetaminophen"), confirmed live to otherwise return
 * zero results for several high-volume ingredients. First name/synonym that
 * yields both a confident single-ingredient label AND non-empty text for
 * this kind wins.
 *
 * Returns null when nothing reliable is found after exhausting every name
 * (never fabricates — the caller must not create any row on null). Throws
 * on a network/server error (5xx, 429, etc.) so the caller's background-job
 * retry/dead-letter handling can distinguish a transient failure from a
 * genuine "no data" answer.
 */
export async function fetchClinicalContent(
  kind: ClinicalContentKind,
  name: string,
  synonyms: string[] = [],
  apiKey?: string,
): Promise<ClinicalContentResult | null> {
  for (const candidate of [name, ...synonyms]) {
    const response = await queryOpenFda(candidate, apiKey);
    const label = pickBestLabel(response);
    if (!label) continue;
    const extraction = extractForKind(label, kind);
    if (!extraction) continue;
    return {
      text: extraction.text,
      sourceCitation: buildCitation(label, candidate, extraction.section),
      sourceUrl: buildSourceUrl(label),
      lowConfidence: extraction.lowConfidence,
    };
  }
  return null;
}
