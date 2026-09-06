"use client";
import type { MessageKey } from "@medpass/localization";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

/**
 * ABHA + ABDM (docs_v2/05 §10, docs_v2/08 §5 M8A/M8B/M8D). ABHA is never
 * required to use this app: these calls only ever run once the patient asks
 * for them. Without gateway credentials the API answers from a recorded
 * mock, so every screen here works the same way in development and CI.
 *
 * Two things this module deliberately never does: write a clinical row (a
 * received bundle becomes document *candidates* the existing confirmation
 * queue reviews), and merge the ABDM profile snapshot into the patient's
 * own profile.
 */

export const ABHA_LINK_METHODS = ["abha_number", "mobile", "aadhaar_otp"] as const;
export type AbhaLinkMethod = (typeof ABHA_LINK_METHODS)[number];

export type AbhaStatusDto =
  | { linked: false; gatewayEnv: string }
  | {
      linked: true;
      gatewayEnv: string;
      abhaAddress: string | null;
      abhaNumberMasked: string;
      linkedAt: string;
      lastVerifiedAt: string | null;
      careContextCount: number;
    };

export interface AbhaLinkInitDto {
  transactionId: string;
  /** Masked destination the OTP went to, e.g. "******9012". */
  otpSentTo: string | null;
  expiresInSeconds: number;
}

export interface AbhaLinkedDto {
  linked: true;
  abhaAddress: string | null;
  abhaNumberMasked: string;
  linkedAt: string;
}

export interface DiscoveredCareContext {
  reference: string;
  display: string;
}

export interface DiscoveredPatient {
  hipId: string;
  hipName: string;
  patientReferenceNumber: string;
  careContexts: DiscoveredCareContext[];
}

export interface DiscoveryResultDto {
  transactionId: string;
  status: "pending" | "completed" | "failed";
  patients: DiscoveredPatient[];
}

export interface CareContextLinkResultDto {
  status: "linked" | "otp_required" | "failed";
  linked: DiscoveredCareContext[];
}

export type AbdmConsentStatus = "requested" | "granted" | "denied" | "revoked" | "expired";

export interface AbdmConsentDto {
  id: string;
  artefactId: string | null;
  consentRequestId: string | null;
  purposeCode: string | null;
  hiTypes: string[];
  hiuId: string | null;
  status: AbdmConsentStatus;
  dateRangeFrom: string | null;
  dateRangeTo: string | null;
  dataEraseAt: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type BundleImportStatus = "received" | "candidates_created" | "rejected" | "erased";

export interface AbdmBundleDto {
  id: string;
  consentArtefactId: string | null;
  transactionId: string | null;
  hiType: string;
  fhirVersion: string | null;
  igVersion: string | null;
  entryCount: number | null;
  importStatus: BundleImportStatus;
  erasedAt: string | null;
  createdAt: string;
}

export interface BundleImportResultDto {
  bundleId: string;
  importStatus: "candidates_created";
  documentId: string;
  extractionId: string;
  candidateCount: number;
  unsupported: unknown[];
  validationFailureCount: number;
}

const ABHA_PATH = "/profiles/current/abha";
const CONSENTS_PATH = "/profiles/current/abdm/consents";
const BUNDLES_PATH = "/profiles/current/abdm/bundles";

export function useAbhaStatus() {
  const { data, error, fromCache, reload } = useSharedResource<AbhaStatusDto>({
    path: ABHA_PATH,
    fetcher: () => api.get<AbhaStatusDto>(ABHA_PATH, { profileId: getActiveProfileId() }),
  });
  return { status: data, error, fromCache, reload };
}

export function invalidateAbha(): void {
  invalidate("profile", ABHA_PATH);
  invalidate("profile", CONSENTS_PATH);
  invalidate("profile", BUNDLES_PATH);
}

/** Step-up guarded — the sheet opens before the OTP is sent to the ABHA. */
export function abhaLinkInit(input: { method: AbhaLinkMethod; abhaNumber?: string; mobile?: string; aadhaar?: string }): Promise<AbhaLinkInitDto> {
  const body: Record<string, string> = { method: input.method };
  if (input.abhaNumber) body.abhaNumber = input.abhaNumber;
  if (input.mobile) body.mobile = input.mobile;
  if (input.aadhaar) body.aadhaar = input.aadhaar;
  return api.post<AbhaLinkInitDto>(`${ABHA_PATH}/link/init`, body, { profileId: getActiveProfileId() });
}

export async function abhaLinkVerify(input: { transactionId: string; otp: string; abhaAddress?: string }): Promise<AbhaLinkedDto> {
  const res = await api.post<AbhaLinkedDto>(`${ABHA_PATH}/link/verify`, input, { profileId: getActiveProfileId() });
  invalidateAbha();
  return res;
}

/**
 * Unlink ends the identity link only: records already imported stay in the
 * record and keep the provenance that says where they came from
 * (docs_v2/05 §10). The screen says so before this is called.
 */
export async function abhaUnlink(): Promise<void> {
  await api.delete(ABHA_PATH, { profileId: getActiveProfileId() });
  invalidateAbha();
}

export function abhaDiscover(hipId?: string): Promise<{ transactionId: string }> {
  return api.post<{ transactionId: string }>(`${ABHA_PATH}/discover`, hipId ? { hipId } : {}, { profileId: getActiveProfileId() });
}

export function abhaDiscoveryResult(txnId: string): Promise<DiscoveryResultDto> {
  return api.get<DiscoveryResultDto>(`${ABHA_PATH}/discover/${encodeURIComponent(txnId)}`, { profileId: getActiveProfileId() });
}

export async function linkCareContexts(input: {
  transactionId: string;
  hipId: string;
  patientReferenceNumber: string;
  careContextReferences: string[];
  otp?: string;
}): Promise<CareContextLinkResultDto> {
  const res = await api.post<CareContextLinkResultDto>(`${ABHA_PATH}/care-contexts/link`, input, { profileId: getActiveProfileId() });
  invalidateAbha();
  return res;
}

export function useAbdmConsents() {
  const { data, error, fromCache, reload } = useSharedResource<AbdmConsentDto[]>({
    path: CONSENTS_PATH,
    fetcher: async () => (await api.get<{ items: AbdmConsentDto[] }>(CONSENTS_PATH, { profileId: getActiveProfileId() })).items,
    mapApiError: (err) => (err.status === 403 ? [] : undefined),
  });
  return { items: data, error, fromCache, reload };
}

/** Step-up guarded. */
export async function revokeAbdmConsent(id: string, reason?: string): Promise<AbdmConsentDto> {
  const body = reason && reason.trim().length > 0 ? { reason: reason.trim() } : {};
  const res = await api.post<AbdmConsentDto>(`${CONSENTS_PATH}/${id}/revoke`, body, { profileId: getActiveProfileId() });
  invalidate("profile", CONSENTS_PATH);
  return res;
}

export function useAbdmBundles() {
  const { data, error, fromCache, reload } = useSharedResource<AbdmBundleDto[]>({
    path: BUNDLES_PATH,
    fetcher: async () => (await api.get<{ items: AbdmBundleDto[] }>(BUNDLES_PATH, { profileId: getActiveProfileId() })).items,
    mapApiError: (err) => (err.status === 403 ? [] : undefined),
  });
  return { items: data, error, fromCache, reload };
}

/**
 * Import creates document candidates only (docs_v2/08 §7) — the caller
 * sends the patient to the existing "Check what we found" queue for the
 * document it created, where each row is confirmed one at a time.
 */
export async function importBundle(id: string): Promise<BundleImportResultDto> {
  const res = await api.post<BundleImportResultDto>(`/abdm/bundles/${id}/import`, undefined, { profileId: getActiveProfileId() });
  invalidate("profile", BUNDLES_PATH);
  invalidate("profile", "/profiles/current/patient-documents");
  return res;
}

export function consentStatusLabelKey(status: AbdmConsentStatus): MessageKey {
  return `abha.consent_status.${status}` as MessageKey;
}

export function bundleStatusLabelKey(status: BundleImportStatus): MessageKey {
  return `abha.bundle_status.${status}` as MessageKey;
}

/** ABDM's HI types are English code words; give the common ones plain names. */
export function hiTypeLabelKey(hiType: string): MessageKey {
  switch (hiType) {
    case "Prescription":
    case "DiagnosticReport":
    case "DischargeSummary":
    case "OPConsultation":
    case "ImmunizationRecord":
    case "HealthDocumentRecord":
    case "WellnessRecord":
      return `abha.hi_type.${hiType}` as MessageKey;
    default:
      return "abha.hi_type.other";
  }
}
