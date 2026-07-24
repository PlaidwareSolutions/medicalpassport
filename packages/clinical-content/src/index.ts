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
 */

const OPENFDA_BASE_URL = "https://api.fda.gov/drug/label.json";

interface OpenFdaLabelResult {
  id?: string;
  set_id?: string;
  effective_time?: string;
  indications_and_usage?: string[];
  openfda?: {
    generic_name?: string[];
    substance_name?: string[];
    brand_name?: string[];
  };
}

interface OpenFdaResponse {
  results?: OpenFdaLabelResult[];
}

export interface IndicationResult {
  text: string;
  sourceCitation: string;
  sourceUrl: string;
}

function isCombinationProduct(result: OpenFdaLabelResult): boolean {
  const substances = result.openfda?.substance_name?.length ? result.openfda.substance_name : (result.openfda?.generic_name ?? []);
  return substances.length > 1;
}

function formatEffectiveDate(effectiveTime: string | undefined): string {
  if (!effectiveTime || effectiveTime.length < 8) return "unknown date";
  return `${effectiveTime.slice(0, 4)}-${effectiveTime.slice(4, 6)}-${effectiveTime.slice(6, 8)}`;
}

function buildCitation(result: OpenFdaLabelResult, matchedName: string): string {
  const setId = result.set_id ?? result.id ?? "unknown";
  const fetchedOn = new Date().toISOString().slice(0, 10);
  return `openFDA/DailyMed structured product label, set id ${setId}, matched on "${matchedName}", label effective ${formatEffectiveDate(result.effective_time)}, fetched ${fetchedOn}`;
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
 * survives filtering — callers must treat that as "no reliable data found",
 * never fabricate a fallback.
 */
export function pickBestIndication(response: OpenFdaResponse, matchedName: string): IndicationResult | null {
  const seen = new Set<string>();
  const candidates = (response.results ?? []).filter((r) => {
    if (!r.indications_and_usage?.length) return false;
    if (!r.openfda) return false;
    if (isCombinationProduct(r)) return false;
    const key = r.set_id ?? r.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => (b.effective_time ?? "").localeCompare(a.effective_time ?? ""));
  const best = candidates[0]!;
  const text = best.indications_and_usage![0]!.trim();
  if (!text) return null;

  return { text, sourceCitation: buildCitation(best, matchedName), sourceUrl: buildSourceUrl(best) };
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
 * Fetches a candidate "commonly used for" indication for a generic
 * ingredient. Tries `name`, then each synonym in turn — this is what
 * bridges the catalog's INN naming (e.g. "Paracetamol") to openFDA's US
 * generic names (e.g. "Acetaminophen"), confirmed live to otherwise return
 * zero results for several high-volume ingredients. First confident
 * single-ingredient match wins.
 *
 * Returns null when nothing reliable is found after exhausting every name
 * (never fabricates — the caller must not create any content row on null).
 * Throws on a network/server error (5xx, 429, etc.) so the caller's
 * background-job retry/dead-letter handling can distinguish a transient
 * failure from a genuine "no data" answer.
 */
export async function fetchIndicationForIngredient(name: string, synonyms: string[] = [], apiKey?: string): Promise<IndicationResult | null> {
  for (const candidate of [name, ...synonyms]) {
    const response = await queryOpenFda(candidate, apiKey);
    const picked = pickBestIndication(response, candidate);
    if (picked) return picked;
  }
  return null;
}
