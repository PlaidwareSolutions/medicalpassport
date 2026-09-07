"use client";
import { ApiError } from "@medpass/api-client";
import type { DiagnosticReportKind, DiagnosticReportStatus, ImagingModality, ObservationInterpretation, ResultComparator } from "@medpass/domain";
import type { MessageKey } from "@medpass/localization";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { invalidateHealthTimeline, type ProvenanceSource, type VerificationState } from "./health-timeline";
import { magnitudeDecimals, roundForDisplay } from "./observations";

/**
 * Diagnostics (docs_v2/04 §6, docs_v2/06 P4-4): labs and imaging in one
 * shape — the V2 successor of `reports`. Every value is shown exactly as
 * entered; the canonical unit sits alongside when it differs (H-35); the
 * lab's own flag is shown as plain text only when the lab supplied it. No
 * client code here compares a value to a range or computes "high"/"low"
 * (docs_v2/10 §1, H-25) — `interpretation` is read, never derived.
 */

export interface DiagnosticResultDto {
  id: string;
  diagnosticReportId: string;
  analyteKey: string;
  /** Display label: the vocabulary's English label, or the free label for `other`. */
  label: string;
  analyteLabelText: string | null;
  loincCode: string | null;
  /** What the patient typed, verbatim — the only value any screen renders as "the result". */
  enteredValueText: string;
  /** Server-parsed twin in the canonical unit, string over JSON; null for qualitative entries. */
  valueNumeric: string | null;
  valueText: string | null;
  comparator: ResultComparator | null;
  /** Canonical unit (UCUM), or null. */
  unit: string | null;
  enteredUnit: string | null;
  referenceLow: string | null;
  referenceHigh: string | null;
  referenceText: string | null;
  /** Set only from the lab's own flag or by a provider — never by this app. */
  interpretation: ObservationInterpretation | null;
  specimenType: string | null;
  sequence: number;
  supersededById: string | null;
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
  createdAt: string;
}

export interface DiagnosticReportDto {
  id: string;
  kind: DiagnosticReportKind;
  category: string | null;
  title: string;
  status: DiagnosticReportStatus;
  specimenCollectedAt: string | null;
  reportedAt: string | null;
  /** Calendar date "YYYY-MM-DD" — the display date. */
  testedAt: string | null;
  organizationId: string | null;
  facilityNameText: string | null;
  orderingPractitionerName: string | null;
  reportingPractitionerName: string | null;
  modality: ImagingModality | null;
  bodySite: string | null;
  impressionText: string | null;
  findingsText: string | null;
  conclusionText: string | null;
  encounterId: string | null;
  legacyMedicalReportId: string | null;
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
  rowVersion: number;
  createdAt: string;
  resultCount: number;
}

export interface DiagnosticReportDetailDto extends DiagnosticReportDto {
  results: DiagnosticResultDto[];
}

export interface CreateDiagnosticReportInput {
  kind: DiagnosticReportKind;
  title: string;
  testedAt?: string;
  specimenCollectedAt?: string;
  reportedAt?: string;
  organizationId?: string | null;
  facilityNameText?: string;
  orderingPractitionerName?: string;
  reportingPractitionerName?: string;
  modality?: ImagingModality;
  bodySite?: string;
  impressionText?: string;
  findingsText?: string;
  conclusionText?: string;
  category?: string;
  encounterId?: string | null;
}

export interface AddDiagnosticResultInput {
  analyteKey: string;
  analyteLabelText?: string;
  enteredValueText: string;
  enteredUnit?: string;
  comparator?: ResultComparator;
  referenceLow?: number;
  referenceHigh?: number;
  referenceText?: string;
  specimenType?: string;
  sequence?: number;
}

/** One unit the patient may enter for an analyte, from `/terminology/analytes`. */
export interface AllowedUnitDto {
  unit: string;
  display: string;
  isCanonical: boolean;
}

export interface AnalyteTerminologyDto {
  key: string;
  display: string;
  group: string;
  loincCode: string | null;
  loincDisplay: string | null;
  canonicalUnit: string | null;
  canonicalUnitDisplay: string | null;
  allowedEnteredUnits: AllowedUnitDto[];
  openEntry: boolean;
}

export interface ResultTrendPointDto {
  resultId: string;
  reportId: string;
  reportTitle: string;
  facilityName: string | null;
  /** ISO instant of the report's effective date. */
  at: string;
  enteredValueText: string;
  enteredUnit: string | null;
  /** In the analyte's canonical unit. */
  value: number;
  unit: string;
  comparator: ResultComparator | null;
  referenceLow: string | null;
  referenceHigh: string | null;
  referenceText: string | null;
  interpretation: ObservationInterpretation | null;
  provenanceSource: ProvenanceSource | null;
  verification: VerificationState | null;
}

export type UnconvertibleReason = "not_numeric" | "unsupported_unit" | "no_canonical_unit";

export interface ResultTrendUnconvertibleDto {
  resultId: string;
  reportId: string;
  reportTitle: string;
  facilityName: string | null;
  at: string;
  enteredValueText: string;
  enteredUnit: string | null;
  reason: UnconvertibleReason;
}

export interface ResultTrendDto {
  analyteKey: string;
  label: string;
  loincCode: string | null;
  canonicalUnit: string | null;
  canonicalUnitDisplay: string | null;
  allowedEnteredUnits: AllowedUnitDto[];
  points: ResultTrendPointDto[];
  /** Never merged into `points` (H-35/H-39): shown separately, each with its own unit. */
  unconvertible: ResultTrendUnconvertibleDto[];
}

const LIST_PATH = "/profiles/current/diagnostic-reports";
const TERMINOLOGY_PATH = "/terminology/analytes";

function bust(reportId?: string): void {
  invalidate("profile", LIST_PATH);
  invalidate("profile", reportId ? `/diagnostic-reports/${reportId}` : "/diagnostic-reports/");
  invalidate("profile", "/profiles/current/trends/results/");
  invalidateHealthTimeline();
}

/**
 * The diagnostics list. `unavailable` is true when the route itself 404s —
 * an API that hasn't shipped Phase 4 yet — and the hub then falls back to
 * the V1 reports list rather than showing an empty archive.
 */
export function useDiagnosticReports() {
  const { data, error, reload } = useSharedResource<{ items: DiagnosticReportDto[]; unavailable: boolean }>({
    path: LIST_PATH,
    fetcher: async () => ({
      items: (await api.get<{ items: DiagnosticReportDto[] }>(LIST_PATH, { profileId: getActiveProfileId() })).items,
      unavailable: false,
    }),
    mapApiError: (err) => (err.status === 404 ? { items: [], unavailable: true } : undefined),
  });
  return { items: data?.items, unavailable: data?.unavailable === true, error, reload };
}

export function useDiagnosticReport(id: string) {
  const path = `/diagnostic-reports/${id}`;
  const { data, error, reload } = useSharedResource<DiagnosticReportDetailDto | { notFound: true }>({
    path,
    fetcher: () => api.get<DiagnosticReportDetailDto>(path, { profileId: getActiveProfileId() }),
    mapApiError: (err) => (err.status === 404 ? { notFound: true } : undefined),
  });
  const notFound = data !== undefined && "notFound" in data;
  return { report: notFound ? undefined : (data as DiagnosticReportDetailDto | undefined), notFound, error, reload };
}

export function useAnalyteTerminology() {
  const { data, error } = useSharedResource<AnalyteTerminologyDto[]>({
    path: TERMINOLOGY_PATH,
    scope: "user",
    // A static code table — identical for every caller, so a long TTL is honest.
    ttlMs: 60 * 60_000,
    fetcher: async () => (await api.get<{ items: AnalyteTerminologyDto[] }>(TERMINOLOGY_PATH)).items,
  });
  return { analytes: data, error };
}

export function useResultTrend(analyteKey: string | undefined) {
  const path = `/profiles/current/trends/results/${analyteKey ?? ""}`;
  const { data, error, reload } = useSharedResource<ResultTrendDto | undefined>({
    path,
    fetcher: () => (analyteKey ? api.get<ResultTrendDto>(path, { profileId: getActiveProfileId() }) : Promise.resolve(undefined)),
  });
  return { trend: data, error, reload };
}

export async function createDiagnosticReport(input: CreateDiagnosticReportInput) {
  const res = await api.post<DiagnosticReportDetailDto>(LIST_PATH, input, { profileId: getActiveProfileId() });
  bust();
  return res;
}

export async function updateDiagnosticReport(id: string, patch: Partial<CreateDiagnosticReportInput>) {
  const res = await api.patch<DiagnosticReportDetailDto>(`/diagnostic-reports/${id}`, patch, { profileId: getActiveProfileId() });
  bust(id);
  return res;
}

export async function deleteDiagnosticReport(id: string) {
  await api.delete(`/diagnostic-reports/${id}`, { profileId: getActiveProfileId() });
  bust();
}

export async function addDiagnosticResult(reportId: string, input: AddDiagnosticResultInput) {
  const res = await api.post<DiagnosticResultDto>(`/diagnostic-reports/${reportId}/results`, input, { profileId: getActiveProfileId() });
  bust(reportId);
  return res;
}

export async function deleteDiagnosticResult(reportId: string, resultId: string) {
  await api.delete(`/diagnostic-results/${resultId}`, { profileId: getActiveProfileId() });
  bust(reportId);
}

/** The first field-level message from a validation problem, else its title. */
export function problemMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  return err.problem.errors?.[0]?.message ?? err.problem.title ?? fallback;
}

// --- pure helpers (unit-tested) -----------------------------------------

/** Kinds in hub order: the ones patients file most first. */
export const DIAGNOSTIC_HUB_KINDS: readonly DiagnosticReportKind[] = [
  "laboratory",
  "imaging",
  "ecg",
  "echo",
  "pathology",
  "microbiology",
  "genetics",
  "other",
];

/** True for the kinds that carry modality / body site / impression / findings. */
export function isImagingKind(kind: DiagnosticReportKind): boolean {
  return kind === "imaging" || kind === "ecg" || kind === "echo";
}

/** Groups reports by kind in hub order, dropping kinds with nothing filed. */
export function groupReportsByKind<T extends { kind: DiagnosticReportKind }>(
  reports: readonly T[],
): Array<{ kind: DiagnosticReportKind; reports: T[] }> {
  return DIAGNOSTIC_HUB_KINDS.map((kind) => ({ kind, reports: reports.filter((r) => r.kind === kind) })).filter((g) => g.reports.length > 0);
}

/**
 * The reference range as one plain string: the structured low/high when
 * present, else the lab's printed text. Display only — never compared.
 */
export function referenceRangeText(r: Pick<DiagnosticResultDto, "referenceLow" | "referenceHigh" | "referenceText">): string | null {
  if (r.referenceLow != null && r.referenceHigh != null) return `${r.referenceLow} – ${r.referenceHigh}`;
  if (r.referenceLow != null) return `≥ ${r.referenceLow}`;
  if (r.referenceHigh != null) return `≤ ${r.referenceHigh}`;
  return r.referenceText;
}

/**
 * Whether the canonical value should be shown beside the entered one:
 * only when the patient entered a different unit and the server could
 * convert (H-35: conversion is never silent, and never replaces the entry).
 */
export function showsCanonicalTwin(r: Pick<DiagnosticResultDto, "unit" | "enteredUnit" | "valueNumeric">): boolean {
  if (!r.unit || r.valueNumeric == null) return false;
  if (!r.enteredUnit) return false;
  return normalizeUnit(r.enteredUnit) !== normalizeUnit(r.unit);
}

function normalizeUnit(u: string): string {
  return u.replace(/\s+/g, "").toLowerCase();
}

/** "YYYY-MM-DD" → locale date without a timezone shift (a calendar date has no zone). */
export function formatDateOnly(isoDate: string, locale?: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale === "en" ? undefined : locale, { timeZone: "UTC" });
}

/**
 * The printed form of a unit code for one analyte, from the terminology
 * table (`10*6/uL` → "million/µL"); the code itself when the table has no
 * row for it, so nothing is ever hidden.
 */
export function analyteUnitDisplay(analytes: readonly AnalyteTerminologyDto[] | undefined, analyteKey: string, unit: string | null | undefined): string {
  if (!unit) return "";
  const analyte = analytes?.find((a) => a.key === analyteKey);
  if (analyte?.canonicalUnit === unit && analyte.canonicalUnitDisplay) return analyte.canonicalUnitDisplay;
  return analyte?.allowedEnteredUnits.find((u) => u.unit === unit)?.display ?? unit;
}

/**
 * How many decimals a converted lab value is shown with.
 *
 * Same rule as the measurement side (see `CONCEPT_DECIMALS` in
 * observations.ts): the stored value keeps every digit the conversion
 * produced, and the entered value is always shown verbatim beside it
 * (H-35); this only decides how the canonical twin is *printed*. An HbA1c
 * of 7.2749 % is reported by every lab in India to one decimal, so
 * "= 7.275 % in the usual unit" invents precision the result never had.
 *
 * Analytes not listed fall back to magnitude, which keeps small values
 * (creatinine 0.94 mg/dL) intact while rounding large ones (a cholesterol
 * in the hundreds) to whole numbers.
 */
const ANALYTE_DECIMALS: Record<string, number> = {
  hba1c: 1,
  fasting_glucose: 0,
  post_prandial_glucose: 0,
  total_cholesterol: 0,
  ldl_cholesterol: 0,
  hdl_cholesterol: 0,
  triglycerides: 0,
  urea: 0,
  wbc_total: 0,
  platelet_count: 0,
  esr: 0,
  vitamin_b12: 0,
  vitamin_d: 1,
  hemoglobin: 1,
  hematocrit: 1,
  uric_acid: 1,
  sodium: 1,
  potassium: 1,
  crp: 1,
  sgpt_alt: 0,
  sgot_ast: 0,
  alkaline_phosphatase: 0,
  total_protein: 1,
  albumin: 1,
  bilirubin_total: 2,
  creatinine: 2,
  rbc_count: 2,
  tsh: 2,
};

/** The decimals one analyte's canonical value is printed with. */
export function analyteDecimals(analyteKey: string, value: number): number {
  return ANALYTE_DECIMALS[analyteKey] ?? magnitudeDecimals(value);
}

/** A converted lab value as a patient reads it — rounded to what the test deserves. */
export function formatAnalyteValue(value: string | number | null | undefined, analyteKey: string): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return roundForDisplay(n, analyteDecimals(analyteKey, n));
}

/**
 * The analyte's name for screens that are *not* the transcribe-off-the-paper
 * picker.
 *
 * `REPORT_ANALYTES` keeps English labels on purpose (docs/34): the picker
 * has to say exactly what the printed report says, or matching gets harder
 * for the reader it claims to help. That reasoning does not reach the
 * condition hub or a trend heading, where the name is the app describing
 * the record back to the patient — so those get a translated label, and
 * fall back to the server's English one for anything the dictionary has
 * not got.
 */
export function analyteLabel(t: (key: MessageKey) => string, analyteKey: string, fallback: string): string {
  const key = `analyte.${analyteKey}` as MessageKey;
  const label = t(key);
  return label === key ? fallback : label;
}
