"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey } from "@medpass/localization";
import { api, getActiveProfileId, newIdempotencyKey } from "./api";
import { invalidate, useSharedResource } from "./data-cache";
import { invalidateHealthTimeline } from "./health-timeline";
import { invalidateMedicationData } from "./medications";
import { formatCalendarDate } from "./patient-time";

/**
 * Documents V2 (docs_v2/09, docs_v2/05 §5): a document is a set of pages
 * with one classification, read asynchronously into *candidates* — proposals
 * that become clinical rows only when a person confirms them. This module
 * is the one place patient-web talks to `patient-documents`,
 * `document-candidates` and `document-extractions`; the screens under
 * `/documents` only render what comes back and pass decisions along.
 *
 * Nothing here can auto-confirm: `confirmCandidate`/`materialize` are only
 * ever called from a tap on the review screen, and the H-02 / H-35 filters
 * below make sure a dose quantity or a lab interpretation can never even be
 * *displayed* as a proposal, whatever the server sends.
 */

// --- kinds ---------------------------------------------------------------

export const DOCUMENT_KINDS = [
  "prescription",
  "laboratory_report",
  "imaging_report",
  "discharge_summary",
  "consultation_note",
  "vaccination_record",
  "referral",
  "insurance",
  "invoice",
  "strip",
  "box",
  "bottle",
  "lab_report",
  "scan_report",
  "imaging_film",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** What the "What is this?" grid offers — the V1 packaging trio collapses to one tile (docs_v2/09 §4). */
export const CHOOSABLE_KINDS: readonly DocumentKind[] = [
  "prescription",
  "laboratory_report",
  "imaging_report",
  "discharge_summary",
  "consultation_note",
  "vaccination_record",
  "referral",
  "insurance",
  "invoice",
  "strip",
  "other",
];

/** The list's filter chips: the kinds a patient actually files, plus the catch-all. */
export const FILTER_KINDS: readonly DocumentKind[] = ["prescription", "laboratory_report", "imaging_report", "discharge_summary", "other"];

export function isDocumentKind(v: string | null | undefined): v is DocumentKind {
  return !!v && (DOCUMENT_KINDS as readonly string[]).includes(v);
}

/** Legacy spellings the classifier never emits collapse onto a chooser tile. */
export function chooserKindFor(kind: string | null | undefined): DocumentKind | undefined {
  if (!isDocumentKind(kind)) return undefined;
  if (kind === "lab_report") return "laboratory_report";
  if (kind === "scan_report" || kind === "imaging_film") return "imaging_report";
  if (kind === "box" || kind === "bottle") return "strip";
  return kind;
}

export function kindLabelKey(kind: string): MessageKey {
  return (isDocumentKind(kind) ? `documents.kind.${kind}` : "documents.kind.other") as MessageKey;
}

export type DocumentGlyph = "prescription" | "report" | "hospital" | "syringe" | "tablet" | "document";

export function kindGlyph(kind: string): DocumentGlyph {
  switch (chooserKindFor(kind)) {
    case "prescription":
      return "prescription";
    case "laboratory_report":
    case "imaging_report":
      return "report";
    case "discharge_summary":
      return "hospital";
    case "vaccination_record":
      return "syringe";
    case "strip":
      return "tablet";
    default:
      return "document";
  }
}

// --- DTOs (apps/api/openapi.json: Documents V2 + Extraction) -------------

export type DocumentStatus = "pending_upload" | "uploaded" | "processing" | "processed" | "failed" | "quarantined" | "deleted";
export type SourceChannel = "camera" | "gallery" | "file" | "share_target" | "provider_import" | "abdm" | "email_intake";

export interface ClassificationDto {
  kind: string | null;
  confidence: number | null;
  classifiedBy: "user" | "deterministic" | "model" | null;
}

export interface DocumentPageDto {
  pageNumber: number;
  status: string;
  contentType: string | null;
  sizeBytes: number | null;
  /** Short-lived, minted per read; never stored. */
  downloadUrl: string | null;
  downloadUrlExpiresAt: string | null;
}

export interface DocumentSummaryDto {
  id: string;
  kind: string;
  title: string | null;
  documentDate: string | null;
  status: DocumentStatus;
  pageCount: number;
  sourceChannel: string;
  classification: ClassificationDto;
  prescriptionId: string | null;
  diagnosticReportId: string | null;
  encounterId: string | null;
  extractionStatus: string | null;
  createdAt: string;
}

export interface DocumentDetailDto {
  id: string;
  kind: string;
  title: string | null;
  documentDate: string | null;
  status: DocumentStatus;
  sourceChannel: string;
  pageCount: number;
  prescriptionId: string | null;
  diagnosticReportId: string | null;
  encounterId: string | null;
  immunizationId: string | null;
  classification: ClassificationDto;
  extraction: { id: string; status: string; candidateCount: number; finishedAt: string | null } | null;
  pages: DocumentPageDto[];
  createdAt: string;
}

export interface DocumentListDto {
  items: DocumentSummaryDto[];
  nextCursor: string | null;
}

export interface UploadAuthorizationDto {
  pageNumber: number;
  uploadUrl: string;
  expiresAt: string;
}

export interface CreatedDocumentDto extends Omit<DocumentDetailDto, "pages"> {
  pages: UploadAuthorizationDto[];
  approachingStorageQuota?: boolean;
}

export type ConfidenceBucket = "high" | "medium" | "low";
export type CandidateStatus = "proposed" | "confirmed" | "corrected" | "rejected";

/** Normalized 0–1 page coordinates. */
export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CandidateDto {
  id: string;
  targetEntity: string;
  targetField: string;
  groupKey: string | null;
  pageNumber: number | null;
  boundingBox: BoundingBox | null;
  detectedText: string;
  proposedValue: unknown;
  confidence: number;
  confidenceBucket: ConfidenceBucket;
  status: CandidateStatus;
  correctedValue: unknown;
  resultingEntityType: string | null;
  resultingEntityId: string | null;
}

export interface CandidateGroupDto {
  targetEntity: string;
  groupKey: string | null;
  candidates: CandidateDto[];
}

export interface ExtractionDto {
  id: string;
  status: "running" | "succeeded" | "failed" | string;
  engine: string;
  engineVersion: string;
  candidateCount: number;
  finishedAt: string | null;
  groups: CandidateGroupDto[];
}

export interface ExtractionResponseDto {
  documentId: string;
  status: DocumentStatus;
  extraction: ExtractionDto | null;
}

export interface CandidateResultDto {
  id: string;
  status: CandidateStatus;
  resultingEntityType: string | null;
  resultingEntityId: string | null;
}

export interface MaterializeResultDto {
  extractionId: string;
  created: Array<{ entityType: string; entityId: string; candidateIds?: string[] }>;
}

export interface TypedMedication {
  doseQuantity: number;
  doseUnit: string;
  frequencyCode?: string;
  pattern?: string;
}

// --- confidence wording (docs_v2/09 §6) ---------------------------------

/**
 * Mirrors packages/document-intelligence/confidence.ts. The server already
 * sends `confidenceBucket` per candidate; these are only for the
 * *classification* confidence, which arrives as a bare number. Re-tuned
 * only with Gate 5 evidence, together with the package.
 */
export const CLASSIFICATION_THRESHOLDS = Object.freeze({ preselect: 0.9, check: 0.6 });

export function classificationBucket(confidence: number | null | undefined): ConfidenceBucket | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  if (confidence >= CLASSIFICATION_THRESHOLDS.preselect) return "high";
  if (confidence >= CLASSIFICATION_THRESHOLDS.check) return "medium";
  return "low";
}

// --- never shown as proposals (H-02, H-35) ------------------------------

/**
 * Belt and braces over the server's NEVER_AUTO_PROPOSED catalogue: even if a
 * future extractor slipped one through, the review screen would not render
 * it. Dose quantity is always typed by the person (docs_v2/09 §1 rule 4);
 * a lab interpretation is a clinical judgement, never a proposal.
 */
const NEVER_SHOWN: Readonly<Record<string, readonly string[]>> = Object.freeze({
  medication: ["doseQuantity"],
  diagnostic_result: ["interpretation"],
});

export function isDisplayableCandidate(c: Pick<CandidateDto, "targetEntity" | "targetField">): boolean {
  return !(NEVER_SHOWN[c.targetEntity] ?? []).includes(c.targetField);
}

/** Groups with the never-shown fields stripped; empty groups dropped. */
export function displayableGroups(groups: CandidateGroupDto[]): CandidateGroupDto[] {
  return groups
    .map((g) => ({ ...g, candidates: g.candidates.filter(isDisplayableCandidate) }))
    .filter((g) => g.candidates.length > 0);
}

// --- accepted files ------------------------------------------------------

export type PageContentType = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "application/pdf";

export const MAX_PAGE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PAGE_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 30;

/** The content type the API accepts for this file, or null when it takes neither the declared type nor the extension. */
export function pageContentTypeFor(file: File): PageContentType | null {
  const declared = (file.type || "").toLowerCase();
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (declared === "image/jpeg" || declared === "image/jpg" || ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (declared === "image/png" || ext === "png") return "image/png";
  if (declared === "image/webp" || ext === "webp") return "image/webp";
  if (declared === "image/heic" || declared === "image/heif" || ext === "heic" || ext === "heif") return "image/heic";
  if (declared === "application/pdf" || ext === "pdf") return "application/pdf";
  return null;
}

export function pageTooLarge(file: File, contentType: PageContentType): boolean {
  return file.size > (contentType === "application/pdf" ? MAX_PAGE_PDF_BYTES : MAX_PAGE_IMAGE_BYTES);
}

// --- reads ---------------------------------------------------------------

export const DOCUMENTS_PATH = "/profiles/current/patient-documents";
const LIST_PAGE_SIZE = 25;

function listPath(kind?: DocumentKind, cursor?: string | null): string {
  const params = new URLSearchParams();
  params.set("limit", String(LIST_PAGE_SIZE));
  if (kind) params.set("kind", kind);
  if (cursor) params.set("cursor", cursor);
  return `${DOCUMENTS_PATH}?${params.toString()}`;
}

export function fetchDocumentsPage(kind?: DocumentKind, cursor?: string | null) {
  return api.get<DocumentListDto>(listPath(kind, cursor), { profileId: getActiveProfileId() });
}

/** Newest first; the first page rides the shared cache, further pages accumulate locally (same shape as the health timeline). */
export function useDocuments(kind?: DocumentKind) {
  const firstPath = listPath(kind);
  const first = useSharedResource<DocumentListDto>({ path: firstPath, fetcher: () => fetchDocumentsPage(kind) });

  const [more, setMore] = useState<{ forPath: string; items: DocumentSummaryDto[]; nextCursor: string | null }>({
    forPath: firstPath,
    items: [],
    nextCursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    setMore({ forPath: firstPath, items: [], nextCursor: null });
  }, [firstPath]);

  const extra = more.forPath === firstPath ? more : { forPath: firstPath, items: [], nextCursor: null };
  const nextCursor = extra.items.length > 0 ? extra.nextCursor : (first.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchDocumentsPage(kind, nextCursor);
      setMore((prev) => {
        const base = prev.forPath === firstPath ? prev.items : [];
        return { forPath: firstPath, items: [...base, ...page.items], nextCursor: page.nextCursor };
      });
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kind is encoded in firstPath
  }, [nextCursor, firstPath]);

  const items = first.data ? dedupe([...first.data.items, ...extra.items]) : undefined;
  return { items, error: first.error, fromCache: first.fromCache, reload: first.reload, hasMore: nextCursor !== null, loadMore, loadingMore };
}

function dedupe(items: DocumentSummaryDto[]): DocumentSummaryDto[] {
  const seen = new Set<string>();
  return items.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}

export function fetchDocument(id: string) {
  return api.get<DocumentDetailDto>(`/patient-documents/${id}`, { profileId: getActiveProfileId() });
}

export function useDocument(id: string) {
  const { data, error, reload, mutate } = useSharedResource<DocumentDetailDto>({
    path: `/patient-documents/${id}`,
    fetcher: () => fetchDocument(id),
  });
  return { document: data, error, reload, mutate };
}

export function fetchExtraction(documentId: string) {
  return api.get<ExtractionResponseDto>(`/patient-documents/${documentId}/extraction`, { profileId: getActiveProfileId() });
}

/** Documents attached to one clinical record — client-filtered over the newest 100 (the API filters by kind only). */
export function useLinkedDocuments(link: { prescriptionId: string } | { diagnosticReportId: string }) {
  const path = `${DOCUMENTS_PATH}?limit=100`;
  const { data, error, reload } = useSharedResource<DocumentListDto>({
    path,
    fetcher: () => api.get<DocumentListDto>(path, { profileId: getActiveProfileId() }),
  });
  const items = data?.items.filter((d) =>
    "prescriptionId" in link ? d.prescriptionId === link.prescriptionId : d.diagnosticReportId === link.diagnosticReportId,
  );
  // `invalidate()` only empties the cache; a mounted hook has to be asked
  // to fetch again, which is what a screen does right after it adds pages.
  return { items, error, reload };
}

// --- writes --------------------------------------------------------------

export function invalidateDocumentData(): void {
  invalidate("profile", DOCUMENTS_PATH);
  invalidate("profile", "/patient-documents/");
  invalidateHealthTimeline();
}

/** Everything a confirmed extraction can have created — the record lists the done screen links to. */
export function invalidateMaterializedData(): void {
  invalidateDocumentData();
  invalidateMedicationData();
  invalidate("profile", "/profiles/current/prescriptions");
  invalidate("profile", "/prescriptions/");
  invalidate("profile", "/profiles/current/reports");
  invalidate("profile", "/reports/");
  invalidate("profile", "/profiles/current/diagnostic");
  invalidate("profile", "/diagnostic");
  invalidate("profile", "/profiles/current/allergies");
  invalidate("profile", "/profiles/current/conditions");
  invalidate("profile", "/profiles/current/immunizations");
  invalidate("profile", "/profiles/current/practitioners");
  invalidate("profile", "/profiles/current/organizations");
}

/** The record a document is filed against (docs_v2/04 §7.2: at most one clinical parent). */
export type DocumentLink = { prescriptionId: string } | { diagnosticReportId: string };

export interface CreateDocumentInput {
  kind?: DocumentKind;
  title?: string;
  sourceChannel: SourceChannel;
  pages: Array<{ contentType: PageContentType; sizeBytes: number }>;
  links?: DocumentLink;
}

export async function createDocument(input: CreateDocumentInput): Promise<CreatedDocumentDto> {
  // The API takes the parent record as top-level fields (packages/validation
  // `createDocumentV2Schema` spreads them); the nested `links` here is only
  // so a caller cannot pass two parents by accident.
  const { links, ...rest } = input;
  const body = { ...rest, ...(links ?? {}) };
  const res = await api.post<CreatedDocumentDto>(DOCUMENTS_PATH, body, {
    idempotencyKey: newIdempotencyKey(),
    profileId: getActiveProfileId(),
  });
  invalidate("profile", DOCUMENTS_PATH);
  return res;
}

/**
 * PUT to the presigned URL with real progress (fetch has no upload progress
 * events). Same headers the V1 path sends; nothing else — the URL itself is
 * the authorization.
 */
export function uploadPageBytes(uploadUrl: string, file: File, contentType: PageContentType, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("upload_failed")));
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.onabort = () => reject(new Error("upload_failed"));
    xhr.send(file);
  });
}

export function completePage(documentId: string, pageNumber: number) {
  return api.post<{ id: string; status: DocumentStatus; pageCount: number }>(
    `/patient-documents/${documentId}/pages/${pageNumber}/complete`,
    undefined,
    { profileId: getActiveProfileId() },
  );
}

/** Authorizes more pages on a document that already exists (a report that grew a page). */
export function authorizePages(documentId: string, pages: Array<{ contentType: PageContentType; sizeBytes: number }>) {
  return api.post<{ pages: UploadAuthorizationDto[] }>(`/patient-documents/${documentId}/pages/authorize-upload`, { pages }, {
    idempotencyKey: newIdempotencyKey(),
    profileId: getActiveProfileId(),
  });
}

/**
 * Files photos or PDFs against a record from its own screen — the V1
 * "take a photo of the report" affordance, on the V2 document model. Adds
 * pages to `existingDocumentId` when the record already has a document, so
 * a report filed with one photo can grow a second page (docs/07 §43/44);
 * otherwise creates a document linked to the record. Returns the document
 * the pages landed in. Rejects an unsupported or oversized file before
 * anything is uploaded, so a bad third page never leaves two orphaned.
 */
export async function attachPagesToRecord(
  link: DocumentLink,
  kind: DocumentKind,
  files: File[],
  channel: "camera" | "gallery",
  existingDocumentId?: string,
): Promise<{ documentId: string }> {
  const pages = files.map((file) => {
    const contentType = pageContentTypeFor(file);
    if (!contentType || pageTooLarge(file, contentType)) throw new Error("unsupported_page");
    return { file, contentType, sizeBytes: file.size };
  });
  const declared = pages.map(({ contentType, sizeBytes }) => ({ contentType, sizeBytes }));

  let documentId: string;
  let authorizations: UploadAuthorizationDto[];
  if (existingDocumentId) {
    documentId = existingDocumentId;
    authorizations = (await authorizePages(existingDocumentId, declared)).pages;
  } else {
    const created = await createDocument({ kind, sourceChannel: channel, pages: declared, links: link });
    documentId = created.id;
    authorizations = created.pages;
  }
  for (const [index, page] of pages.entries()) {
    const authorization = authorizations[index];
    if (!authorization) throw new Error("upload_failed");
    await uploadPageBytes(authorization.uploadUrl, page.file, page.contentType, () => undefined);
    await completePage(documentId, authorization.pageNumber);
  }
  invalidateDocumentData();
  return { documentId };
}

export interface UpdateDocumentInput {
  kind?: DocumentKind;
  title?: string | null;
  documentDate?: string | null;
}

/** The patient's choice of kind is a decision the classifier can never overrule (docs_v2/09 §4). */
export async function updateDocument(documentId: string, patch: UpdateDocumentInput): Promise<DocumentDetailDto> {
  const res = await api.patch<DocumentDetailDto>(`/patient-documents/${documentId}`, patch, {
    idempotencyKey: newIdempotencyKey(),
    profileId: getActiveProfileId(),
  });
  invalidateDocumentData();
  return res;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await api.delete(`/patient-documents/${documentId}`, { profileId: getActiveProfileId() });
  invalidateDocumentData();
}

export async function processDocument(documentId: string): Promise<DocumentDetailDto> {
  const res = await api.post<DocumentDetailDto>(`/patient-documents/${documentId}/process`, undefined, { profileId: getActiveProfileId() });
  invalidate("profile", `/patient-documents/${documentId}`);
  return res;
}

export function confirmCandidate(candidateId: string, body: { correctedValue?: unknown; medication?: TypedMedication } = {}) {
  return api.post<CandidateResultDto>(`/document-candidates/${candidateId}/confirm`, body, { profileId: getActiveProfileId() });
}

export function rejectCandidate(candidateId: string) {
  return api.post<CandidateResultDto>(`/document-candidates/${candidateId}/reject`, {}, { profileId: getActiveProfileId() });
}

export function materializeExtraction(extractionId: string, candidateIds: string[], medication?: TypedMedication) {
  return api.post<MaterializeResultDto>(
    `/document-extractions/${extractionId}/materialize`,
    { candidateIds, ...(medication ? { medication } : {}) },
    { idempotencyKey: newIdempotencyKey(), profileId: getActiveProfileId() },
  );
}

// --- display helpers -----------------------------------------------------

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export function entityLabelKey(entity: string): MessageKey {
  return `documents.entity.${entity}` as MessageKey;
}

export function fieldLabelKey(entity: string, field: string): MessageKey {
  return `documents.field.${entity}.${field}` as MessageKey;
}

const DATE_FIELDS = new Set([
  "prescribedAt",
  "validUntil",
  "followUpOn",
  "testedAt",
  "reportedAt",
  "specimenCollectedAt",
  "startedAt",
  "endedAt",
  "administeredOn",
]);

/** The value a person would read for a candidate — the proposal, or the correction when one was made. */
export function effectiveValue(c: Pick<CandidateDto, "status" | "proposedValue" | "correctedValue">, localCorrection?: unknown): unknown {
  if (localCorrection !== undefined) return localCorrection;
  return c.status === "corrected" && c.correctedValue !== undefined && c.correctedValue !== null ? c.correctedValue : c.proposedValue;
}

export function frequencyText(value: unknown, t: Translate): string {
  if (!value || typeof value !== "object") return "";
  const v = value as { code?: string; pattern?: string };
  if (v.code === "PATTERN") return v.pattern ?? "";
  return v.code ? t(`frequency.${v.code.toLowerCase()}` as MessageKey) : "";
}

/** Human text for any candidate value; never a raw JSON dump. */
export function valueText(c: Pick<CandidateDto, "targetEntity" | "targetField">, value: unknown, t: Translate): string {
  if (value === null || value === undefined) return "";
  const field = c.targetField;
  if (field === "brandName" && typeof value === "object") return String((value as { label?: string }).label ?? "");
  if (field === "strengthLabel" && typeof value === "object") {
    const q = value as { value?: string; unit?: string };
    return `${q.value ?? ""} ${q.unit ?? ""}`.trim();
  }
  if (field === "frequency") return frequencyText(value, t);
  if (field === "foodInstruction" && typeof value === "string") return t(`food.${value}` as MessageKey);
  if (field === "durationDays" && typeof value === "number") return t("documents.value.days", { n: value });
  if (field === "form" && typeof value === "string") return t(`documents.form.${value}` as MessageKey);
  if (field === "kind" && c.targetEntity === "encounter" && typeof value === "string") return t(`documents.encounter_kind.${value}` as MessageKey);
  if (DATE_FIELDS.has(field) && typeof value === "string") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatCalendarDate(value) : new Date(value).toLocaleString();
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

export interface CorrectionChoice {
  key: string;
  label: string;
  value: unknown;
}

const FREQUENCY_CODES = ["OD", "BD", "TDS", "QID", "SOS", "HS"] as const;
const PATTERNS = ["1-0-1", "1-1-1", "1-0-0", "0-0-1", "0-1-0", "1-1-0"] as const;
const FOOD = ["before", "with", "after", "any", "bedtime"] as const;
const FORMS = ["tablet", "capsule", "syrup", "suspension", "injection", "drops", "cream", "ointment", "gel", "inhaler", "sachet", "powder", "lotion", "other"] as const;
const LAB_UNITS = ["mg/dL", "mmol/L", "g/dL", "%", "mg/L", "U/L", "IU/L", "mEq/L", "ng/mL", "µIU/mL", "cells/µL", "x10^3/µL"] as const;
const COMPARATORS = ["<", "<=", ">", ">="] as const;
const ENCOUNTER_KINDS = ["outpatient", "inpatient", "emergency", "teleconsultation", "day_care", "other"] as const;

/**
 * Typing-free corrections (docs_v2/09 §10): a picker exists only where the
 * V1 patterns already have one, or where the value is a closed list. A
 * medicine name has no picker here — a wrong name is a "No", not a guess.
 */
export function correctionChoices(c: Pick<CandidateDto, "targetEntity" | "targetField">, t: Translate): CorrectionChoice[] | null {
  switch (c.targetField) {
    case "frequency":
      return [
        ...FREQUENCY_CODES.map((code) => ({ key: code, label: t(`frequency.${code.toLowerCase()}` as MessageKey), value: { code } })),
        ...PATTERNS.map((pattern) => ({ key: `P${pattern}`, label: pattern, value: { code: "PATTERN", pattern } })),
      ];
    case "foodInstruction":
      return FOOD.map((v) => ({ key: v, label: t(`food.${v}` as MessageKey), value: v }));
    case "form":
      return FORMS.map((v) => ({ key: v, label: t(`documents.form.${v}` as MessageKey), value: v }));
    case "enteredUnit":
      return LAB_UNITS.map((v) => ({ key: v, label: v, value: v }));
    case "comparator":
      return COMPARATORS.map((v) => ({ key: v, label: v, value: v }));
    case "kind":
      return c.targetEntity === "encounter"
        ? ENCOUNTER_KINDS.map((v) => ({ key: v, label: t(`documents.encounter_kind.${v}` as MessageKey), value: v }))
        : null;
    default:
      return null;
  }
}

/** Where a created record lives; null when this app has no screen for it yet. */
export function entityHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case "patient_medication":
      return `/medicines/${entityId}`;
    case "prescription":
      return `/prescriptions/${entityId}`;
    case "diagnostic_report":
      // Same mapping the health timeline uses for test results (lib/health-timeline eventHref).
      return `/reports/${entityId}`;
    case "patient_condition":
      return "/conditions";
    case "patient_allergy":
      return "/allergies";
    case "immunization":
      return "/immunizations";
    case "practitioner":
      return "/doctors";
    case "organization":
      return "/organizations";
    default:
      return null;
  }
}

export function entityTypeLabelKey(entityType: string): MessageKey {
  return `documents.created.${entityType}` as MessageKey;
}

/** The name a group is known by on screen — the medicine, the doctor, the lab row. */
export function groupTitle(group: CandidateGroupDto, t: Translate, corrections: Record<string, unknown> = {}): string {
  const pick = (field: string) => group.candidates.find((c) => c.targetField === field && c.status !== "rejected");
  const anchor =
    group.targetEntity === "medication"
      ? (pick("brandName") ?? pick("genericName"))
      : group.targetEntity === "diagnostic_result"
        ? pick("analyteLabelText")
        : group.targetEntity === "practitioner" || group.targetEntity === "organization"
          ? pick("displayName")
          : group.targetEntity === "immunization"
            ? pick("vaccineText")
            : group.targetEntity === "condition" || group.targetEntity === "allergy"
              ? pick("label")
              : undefined;
  const name = anchor ? valueText(anchor, effectiveValue(anchor, corrections[anchor.id]), t) : "";
  const entity = t(entityLabelKey(group.targetEntity));
  return name ? `${entity}: ${name}` : entity;
}
