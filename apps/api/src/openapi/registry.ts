/**
 * OpenAPI route registry (ADR-V2-013, Phase 0 ticket 0.13).
 *
 * One declarative row per HTTP route. `build-document.ts` enumerates the
 * real routes from the booted Nest app and merges these rows in; the
 * coverage spec fails when a route has no row here or a row names a route
 * that no longer exists. Auth / step-up / rate-limit facts are cross-checked
 * against the decorators on the handler, so a row cannot quietly claim less
 * protection than the code enforces.
 *
 * Conventions:
 * - `path` is the final path as Nest exposes it (`/v1/...` prefix, `:param`
 *   syntax) — copy it straight from the controller + `@Controller()` prefix.
 * - `request` / `query` are the Zod schemas the handler passes to
 *   `parseWith()` — import them from `@medpass/validation`, never inline a
 *   copy. Ad-hoc `@Query("x")` parameters are listed as `QueryParam[]`.
 * - Responses without a Zod schema use the hand-written fragments in
 *   `./schemas.ts` and MUST say `responseSchemaSource: "hand-written"`.
 * - `headers` lists request headers the handler reads beyond the global
 *   conventions (`x-profile-id`, `idempotency-key`, webhook signatures).
 */
import type { ZodTypeAny } from "zod";
import {
  acceptInviteSchema,
  activityQuerySchema,
  addDiagnosticResultSchema,
  addReportValueSchema,
  adminAuditSearchSchema,
  adminCreateOrganizationSchema,
  adminOrganizationsQuerySchema,
  adminPractitionersQuerySchema,
  adminUpdateOrganizationSchema,
  adminVerifyOrganizationSchema,
  adminVerifyPractitionerSchema,
  adminFindingsSearchSchema,
  adminLoginSchema,
  adminMfaCodeSchema,
  adminRefreshSchema,
  adminRevokeShareSchema,
  allergySchema,
  authorizeDocumentPagesSchema,
  authorizeUploadSchema,
  bloodPressureReadingSchema,
  catalogSearchSchema,
  changeMedicationStatusSchema,
  checkupRecordSchema,
  claimInviteSchema,
  claimProfileSchema,
  conditionSchema,
  confirmCandidateSchema,
  confirmDocumentCandidateSchema,
  confirmDoseUnitSchema,
  createDocumentV2Schema,
  documentListQuerySchema,
  materializeExtractionSchema,
  rejectDocumentCandidateSchema,
  updateDocumentV2Schema,
  createDependentSchema,
  createEmergencyContactSchema,
  createFamilyHistorySchema,
  createImmunizationSchema,
  createLeadSchema,
  createMedicationFromExtractionSchema,
  createMedicationSchema,
  createOrganizationSchema,
  createPractitionerSchema,
  createProcedureSchema,
  createPrescriptionSchema,
  correctDiagnosticResultSchema,
  createDiagnosticReportSchema,
  createReportSchema,
  createSelfProfileSchema,
  createShareSchema,
  decideCatalogChangeSchema,
  decideContentChangeSchema,
  decideContentTranslationSchema,
  deviceLoginSchema,
  encounterSchema,
  glucoseReadingSchema,
  grantConsentSchema,
  healthTimelineQuerySchema,
  inviteCaregiverSchema,
  linkMedicationSchema,
  prescriptionItemSchema,
  startMedicationFromItemSchema,
  diagnosticReportsQuerySchema,
  diagnosticResultsQuerySchema,
  measurementDeviceSchema,
  observationBatchSchema,
  observationSchema,
  observationTrendQuerySchema,
  observationsQuerySchema,
  resultTrendQuerySchema,
  updateDiagnosticReportSchema,
  updateMeasurementDeviceSchema,
  updatePrescriptionItemSchema,
  mergeOrganizationSchema,
  mergePractitionerSchema,
  notificationPreferencesSchema,
  otpRequestSchema,
  otpVerifySchema,
  proposeCatalogChangeSchema,
  proposeContentChangeSchema,
  proposeContentTranslationSchema,
  recordDoseEventSchema,
  recordFindingActionSchema,
  recordPrnDoseEventSchema,
  putRefillPlanSchema,
  recordRefillSchema,
  refreshSchema,
  rejectCandidateSchema,
  reportValueHistoryQuerySchema,
  stepUpVerifySchema,
  syncBatchSchema,
  timelineQuerySchema,
  updateAllergySchema,
  updateCaregiverScopesSchema,
  updateConditionSchema,
  updateEmergencyContactSchema,
  updateFamilyHistorySchema,
  updateImmunizationSchema,
  updateEncounterSchema,
  updateMedicationSchema,
  updateOrganizationSchema,
  updatePractitionerSchema,
  updateProcedureSchema,
  updateProfileSchema,
  visitSummaryTextQuerySchema,
  webPushSubscribeSchema,
  webPushUnsubscribeSchema,
  weightReadingSchema,
  providerLoginSchema,
  providerTotpSchema,
  updateProviderOrganizationSchema,
  addOrganizationMemberSchema,
  updateOrganizationMemberSchema,
  createOnboardingTokenSchema,
  onboardPatientSchema,
  proposeReconciliationSchema,
  proposePrescriptionSchema,
  proposeEncounterSchema,
  proposeDispenseSchema,
  proposeDiagnosticReportSchema,
  proposeDischargeSchema,
  proposalsQuerySchema,
  acceptProposalSchema,
  rejectProposalSchema,
} from "@medpass/validation";
import {
  abdmCareContextLinkSchema,
  abdmConsentRevokeSchema,
  abdmDiscoverSchema,
  abhaLinkInitSchema,
  abhaLinkVerifySchema,
  fhirExportQuerySchema,
  fhirPatientSummaryQuerySchema,
} from "@medpass/validation";
import {
  abdmTransactionsQuerySchema,
  breakGlassListQuerySchema,
  breakGlassRequestSchema,
  consentAuditQuerySchema,
  createSupportCaseSchema,
  createTestDueSchema,
  documentsStatusQuerySchema,
  fhirValidationFailuresQuerySchema,
  measurementRemindersSchema,
  notificationFailuresQuerySchema,
  putFeatureFlagSchema,
  supportCaseNoteSchema,
  supportCasesQuerySchema,
  updateSupportCaseSchema,
  updateTestDueSchema,
} from "@medpass/validation";
import * as S from "./schemas";
import type { JsonSchema } from "./schemas";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

/**
 * - `public`: no credential at all.
 * - `patient`: opaque session (cookie or bearer) via the global `AuthGuard`.
 * - `admin`: admin-portal session via `AdminAuthGuard` (class-level `@Public()` only skips the patient guard).
 * - `share-token`: unauthenticated, the capability token in the path is the authorization.
 * - `webhook`: unauthenticated, verified by a provider signature header.
 * - `provider`: provider-portal session via `ProviderGuard` (class-level `@Public()` only skips the patient guard).
 */
export type AuthKind = "public" | "patient" | "admin" | "share-token" | "webhook" | "provider";

export interface QueryParam {
  name: string;
  schema: JsonSchema;
  required?: boolean;
  description?: string;
}

export interface ResponseSpec {
  status: number;
  schema?: ZodTypeAny | JsonSchema;
  description?: string;
  /** Defaults to `application/json`. */
  contentType?: string;
}

export interface RouteDoc {
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  auth: AuthKind;
  /** Handler carries `@RequiresStepUp()` → documented `403 step_up_required`. */
  stepUp?: boolean;
  /** The `@RateLimit({ name })` bucket on the handler. */
  rateLimit?: string;
  /** Zod schema passed to `parseWith()` for the JSON body. */
  request?: ZodTypeAny;
  /** The body may be omitted (e.g. a cookie carries the same credential). */
  requestOptional?: boolean;
  /** Zod schema passed to `parseWith()` for the query string, or ad-hoc `@Query()` params. */
  query?: ZodTypeAny | QueryParam[];
  /** Success body. Omit only for `204` routes. */
  response?: ZodTypeAny | JsonSchema | ResponseSpec[];
  responseSchemaSource?: "zod" | "hand-written";
  /** Request headers beyond the global conventions. */
  headers?: string[];
  /** `ProfileAccessService.require()` action — the caregiver scope needed. */
  scope?: string;
  /** `requireAdminDuty()` duty. */
  duty?: string;
  deprecated?: boolean;
}

const PROFILE = "x-profile-id";
const IDEMPOTENCY = "idempotency-key";
/** Channel that wrote the row (recordedVia, ADR-V2-002): one of the @medpass/provenance RECORDED_VIA values; absent means pwa. */
const CLIENT = "x-client";

/** Hand-written response shorthand. */
const hw = (schema: JsonSchema | ResponseSpec[]): Pick<RouteDoc, "response" | "responseSchemaSource"> => ({
  response: schema,
  responseSchemaSource: "hand-written",
});

const pdf = (description: string): ResponseSpec[] => [
  { status: 200, schema: S.binaryPdf, contentType: "application/pdf", description },
];

const statusQuery: QueryParam[] = [{ name: "status", schema: { type: "string" }, description: "Filter by status." }];

const T = {
  health: "Health",
  meta: "Meta",
  auth: "Auth",
  adminAuth: "Admin: Auth",
  adminAudit: "Admin: Audit",
  adminCatalog: "Admin: Catalog",
  adminContent: "Admin: Content",
  adminIncidents: "Admin: Incidents",
  adminOperations: "Admin: Operations",
  adminRules: "Admin: Rules",
  adminUsers: "Admin: Users",
  adminProviders: "Admin: Providers",
  adminPlatform: "Admin: Platform",
  adminSupport: "Admin: Support",
  adminAbdm: "Admin: ABDM",
  adminFhir: "Admin: FHIR",
  profiles: "Profiles",
  caregivers: "Caregivers",
  claims: "Claims",
  consents: "Consents",
  catalog: "Catalog",
  documents: "Documents",
  documentsV2: "Documents V2",
  extraction: "Extraction",
  glucose: "Glucose",
  vitals: "Vitals",
  leads: "Leads",
  medications: "Medications",
  notifications: "Notifications",
  webhooks: "Webhooks",
  practitioners: "Practitioners",
  organizations: "Organizations",
  prescriptions: "Prescriptions",
  reports: "Reports",
  diagnostics: "Diagnostics",
  observations: "Observations",
  terminology: "Terminology",
  safety: "Safety",
  scheduling: "Scheduling",
  encounters: "Encounters",
  clinicalProfile: "Clinical profile",
  healthTimeline: "Health timeline",
  sharing: "Sharing",
  sync: "Sync",
  providerAuth: "Provider: Auth",
  providerOrganizations: "Provider: Organizations",
  providerPatients: "Provider: Patients",
  providerProposals: "Provider: Proposals",
  proposals: "Proposals",
  fhir: "FHIR",
  abdm: "ABDM",
} as const;

export const TAG_DESCRIPTIONS: Record<string, string> = {
  [T.health]: "Liveness/readiness probes, registered outside the /v1 prefix.",
  [T.meta]: "Platform metadata: version, feature flags, the pinned OpenAPI document.",
  [T.auth]: "Patient identity: phone OTP sign-in, remembered devices, session refresh, step-up (ADR-V2-012).",
  [T.adminAuth]: "Admin-portal sessions: password + TOTP MFA, separate cookie and privilege model.",
  [T.profiles]: "Patient profiles (self, dependents) and their clinical profile lists.",
  [T.clinicalProfile]: "Structured clinical profile (docs_v2/05 §2): allergies, conditions, immunizations, procedures, family history, emergency contacts. Clients never send `provenance`.",
  [T.organizations]: "Patient-scoped facilities (docs_v2/05 §2).",
  [T.caregivers]: "Caregiver invitations, scopes and access logs.",
  [T.sharing]: "Visit summaries and time-boxed public share links.",
  [T.sync]: "Offline mutation replay (docs/15).",
  [T.providerAuth]: "Provider-portal sessions (docs_v2/05 §11): phone OTP sign-in for organization staff; a distinct token type from patient and admin sessions.",
  [T.providerOrganizations]: "The signed-in staff member's organization and its members (owner-only writes). The organization kind decides which proposal kinds it may send.",
  [T.providerPatients]: "QR onboarding and the section-scoped, time-boxed ProviderPatientLink; every provider read is audited with the organization id.",
  [T.providerProposals]: "Providers propose, patients accept (ADR-V2-009): reconciliations, prescriptions, encounters, dispenses, diagnostic reports and discharge transitions are stored as proposals and write nothing clinical until accepted.",
  [T.proposals]: "The patient's Proposals inbox: everything awaiting acceptance across organizations, and the accept / reject decisions.",
  [T.fhir]: "FHIR R4 export of the patient's own record through the versioned ABDM IG layer (docs_v2/08 §2, §8; ADR-V2-001/003). Step-up guarded and audited; mapping gaps are recorded as FhirValidationFailure rows, never blocking.",
  [T.abdm]: "ABHA identity and ABDM PHR flows (docs_v2/05 §10, docs_v2/08 §5). ABHA is never required to use the product. Received bundles only ever become confirmation-queue candidates (docs_v2/08 §7).",
  [T.healthTimeline]: "Unified health timeline (docs_v2/05 §3) — distinct from the per-day dose timeline under Scheduling.",
  [T.webhooks]: "Provider callbacks verified by signature; never carry patient credentials.",
  [T.adminProviders]: "Provider / facility directory (provider_admin duty): global Organization and Practitioner entries, HFR/HPR verification, merges. Patient-entered rows are returned as opaque ids with counts only.",
  [T.adminPlatform]: "V2 admin platform (docs_v2/14 §3): feature flags (super_admin), break-glass grants and log (audit_search), consent audit (audit_search), document-processing funnel, integrations health and notification failures (operations_view). Ids are opaque; no clinical value is ever returned.",
  [T.adminSupport]: "Support cases (support_cases duty, docs_v2/14 §5): operational records that point at a profile by opaque id only; notes are PHI-free by policy. Break-glass is a separate, audited grant.",
  [T.adminAbdm]: "AbdmTransaction explorer (abdm_operations duty): kinds, statuses, gateway ids, error codes and timings — never request or response bodies.",
  [T.adminFhir]: "FhirValidationFailure rows (fhir_view duty): structural validator findings by direction, IG version and resource path.",
  [T.diagnostics]: "Labs and imaging (docs_v2/05 §6) — the V2 successor to Reports, with units, structured reference ranges and corrections that supersede instead of overwrite. The V1 `reports` endpoints stay live and now dual-write here.",
  [T.observations]: "Home measurements and vitals (docs_v2/05 §7, ADR-V2-011) — one model for every concept, plus device sync and measurement devices. The V1 glucose / blood-pressure / weight diaries stay live and now dual-write here.",
  [T.terminology]: "Static, PHI-free code tables (LOINC codes, canonical units, plausibility ranges). Public: identical for every caller, and needed before there is a session.",
};

export const ROUTES: RouteDoc[] = [
  // ───────────────────────── Health / Meta ─────────────────────────
  { method: "GET", path: "/healthz", summary: "Liveness probe", tags: [T.health], auth: "public", ...hw(S.healthz) },
  {
    method: "GET",
    path: "/readyz",
    summary: "Readiness probe (checks PostgreSQL)",
    tags: [T.health],
    auth: "public",
    ...hw(S.readyz),
  },
  { method: "GET", path: "/v1/meta/version", summary: "API version (PWA update checks)", tags: [T.meta], auth: "public", ...hw(S.version) },
  { method: "GET", path: "/v1/meta/flags", summary: "Feature flags", tags: [T.meta], auth: "public", ...hw(S.flags) },
  {
    method: "GET",
    path: "/v1/meta/openapi.json",
    summary: "The pinned OpenAPI 3.1 document (this file)",
    description: "Serves `apps/api/openapi.json` exactly as committed (ADR-V2-013). Public, contains no PHI.",
    tags: [T.meta],
    auth: "public",
    ...hw(S.openapiDocument),
  },

  // ───────────────────────── Auth ─────────────────────────
  { method: "GET", path: "/v1/auth/otp-transport", summary: "Which OTP delivery channel is active", tags: [T.auth], auth: "public", ...hw(S.otpTransport) },
  {
    method: "POST",
    path: "/v1/auth/otp/request",
    summary: "Request a sign-in OTP",
    description: "Covers both login and recovery. Optional Turnstile token is verified when configured.",
    tags: [T.auth],
    auth: "public",
    rateLimit: "otp_request",
    request: otpRequestSchema,
    ...hw(S.otpRequested),
  },
  {
    method: "POST",
    path: "/v1/auth/otp/verify",
    summary: "Verify an OTP and open a session",
    description: "Sets the `medpass_session` / `medpass_refresh` httpOnly cookies and (when the device is remembered) `medpass_device_trust`.",
    tags: [T.auth],
    auth: "public",
    rateLimit: "otp_verify",
    request: otpVerifySchema,
    ...hw(S.issuedSession),
  },
  {
    method: "POST",
    path: "/v1/auth/device-login",
    summary: "Silent sign-in from a remembered device",
    tags: [T.auth],
    auth: "public",
    rateLimit: "device_login",
    request: deviceLoginSchema,
    ...hw(S.issuedSession),
  },
  {
    method: "POST",
    path: "/v1/auth/refresh",
    summary: "Rotate the session using the refresh token",
    description: "Reads the `medpass_refresh` cookie when present; otherwise the body must carry `refreshToken` (native clients).",
    tags: [T.auth],
    auth: "public",
    request: refreshSchema,
    requestOptional: true,
    ...hw(S.issuedSession),
  },
  { method: "POST", path: "/v1/auth/logout", summary: "Sign out (also drops device trust)", tags: [T.auth], auth: "patient" },
  { method: "GET", path: "/v1/auth/devices", summary: "List remembered devices", tags: [T.auth], auth: "patient", ...hw(S.itemsOf(S.device)) },
  { method: "DELETE", path: "/v1/auth/devices/:id", summary: "Revoke a remembered device", tags: [T.auth], auth: "patient" },
  {
    method: "GET",
    path: "/v1/auth/session",
    summary: "Current session incl. step-up freshness",
    tags: [T.auth],
    auth: "patient",
    ...hw(S.sessionStatus),
  },
  {
    method: "POST",
    path: "/v1/auth/step-up",
    summary: "Send a step-up OTP to the signed-in user",
    tags: [T.auth],
    auth: "patient",
    rateLimit: "step_up_request",
    ...hw(S.otpRequested),
  },
  {
    method: "POST",
    path: "/v1/auth/step-up/verify",
    summary: "Verify the step-up OTP",
    tags: [T.auth],
    auth: "patient",
    rateLimit: "step_up_verify",
    request: stepUpVerifySchema,
    ...hw(S.stepUpVerified),
  },

  // ───────────────────────── Admin: Auth ─────────────────────────
  {
    method: "POST",
    path: "/v1/admin/auth/login",
    summary: "Admin password login (MFA pending)",
    tags: [T.adminAuth],
    auth: "public",
    rateLimit: "admin_login",
    request: adminLoginSchema,
    ...hw(S.adminAuthStatus),
  },
  {
    method: "POST",
    path: "/v1/admin/auth/mfa/enroll",
    summary: "Start TOTP enrollment",
    description: "Allowed on a password-verified, MFA-pending session.",
    tags: [T.adminAuth],
    auth: "admin",
    ...hw(S.mfaEnrollment),
  },
  {
    method: "POST",
    path: "/v1/admin/auth/mfa/enroll/confirm",
    summary: "Confirm TOTP enrollment with a first code",
    tags: [T.adminAuth],
    auth: "admin",
    request: adminMfaCodeSchema,
    ...hw(S.adminAuthStatus),
  },
  {
    method: "POST",
    path: "/v1/admin/auth/mfa/verify",
    summary: "Verify TOTP for the pending session",
    tags: [T.adminAuth],
    auth: "admin",
    request: adminMfaCodeSchema,
    ...hw(S.adminAuthStatus),
  },
  {
    method: "POST",
    path: "/v1/admin/auth/refresh",
    summary: "Rotate the admin session",
    description: "Reads the `medpass_admin_refresh` cookie when present; otherwise the body must carry `refreshToken`.",
    tags: [T.adminAuth],
    auth: "public",
    request: adminRefreshSchema,
    requestOptional: true,
    ...hw(S.adminAuthStatus),
  },
  { method: "POST", path: "/v1/admin/auth/logout", summary: "Admin sign-out", tags: [T.adminAuth], auth: "admin" },
  { method: "GET", path: "/v1/admin/auth/sessions", summary: "List the admin's live sessions", tags: [T.adminAuth], auth: "admin", ...hw(S.itemsOf(S.adminSessionRow)) },
  { method: "DELETE", path: "/v1/admin/auth/sessions/:id", summary: "Revoke one admin session", tags: [T.adminAuth], auth: "admin" },
  { method: "GET", path: "/v1/admin/auth/me", summary: "Current admin and duties", tags: [T.adminAuth], auth: "admin", ...hw(S.adminMe) },

  // ───────────────────────── Admin: Audit / Catalog / Content / Incidents / Ops / Rules / Users ─────────────────────────
  {
    method: "GET",
    path: "/v1/admin/audit",
    summary: "Search the hash-chained audit log",
    tags: [T.adminAudit],
    auth: "admin",
    duty: "search_audit",
    query: adminAuditSearchSchema,
    ...hw(S.pageOf(S.anyObject, { type: ["string", "null"], description: "Next `seq` cursor." })),
  },
  {
    method: "GET",
    path: "/v1/admin/catalog-changes",
    summary: "List catalog change proposals",
    tags: [T.adminCatalog],
    auth: "admin",
    duty: "read_catalog",
    query: [
      { name: "status", schema: { type: "string" } },
      { name: "entityType", schema: { type: "string" } },
      { name: "requestedBy", schema: { type: "string", format: "uuid" } },
    ],
    ...hw(S.itemsOf(S.entity)),
  },
  { method: "GET", path: "/v1/admin/catalog-changes/:id", summary: "Catalog change proposal detail", tags: [T.adminCatalog], auth: "admin", duty: "read_catalog", ...hw(S.entity) },
  {
    method: "POST",
    path: "/v1/admin/catalog-changes",
    summary: "Propose a catalog change (maker)",
    tags: [T.adminCatalog],
    auth: "admin",
    duty: "propose_catalog_change",
    request: proposeCatalogChangeSchema,
    ...hw(S.entity),
  },
  {
    method: "POST",
    path: "/v1/admin/catalog-changes/:id/decide",
    summary: "Approve or reject a catalog change (checker)",
    tags: [T.adminCatalog],
    auth: "admin",
    duty: "decide_catalog_change",
    request: decideCatalogChangeSchema,
    ...hw(S.entity),
  },
  {
    method: "GET",
    path: "/v1/admin/catalog/:entityType",
    summary: "Browse a catalog entity type",
    tags: [T.adminCatalog],
    auth: "admin",
    duty: "read_catalog",
    query: [
      { name: "q", schema: { type: "string" }, description: "Name search." },
      { name: "cursor", schema: { type: "string", format: "uuid" } },
      { name: "limit", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
    ],
    ...hw(S.pageOf(S.entity)),
  },
  { method: "GET", path: "/v1/admin/catalog/:entityType/:id", summary: "Catalog entity detail", tags: [T.adminCatalog], auth: "admin", duty: "read_catalog", ...hw(S.entity) },
  { method: "GET", path: "/v1/admin/content", summary: "List clinical content items", tags: [T.adminContent], auth: "admin", duty: "read_content", ...hw(S.itemsOf(S.entity)) },
  { method: "GET", path: "/v1/admin/content/versions", summary: "Content version review queue", tags: [T.adminContent], auth: "admin", duty: "read_content", query: statusQuery, ...hw(S.itemsOf(S.entity)) },
  { method: "GET", path: "/v1/admin/content/:id", summary: "Content item detail", tags: [T.adminContent], auth: "admin", duty: "read_content", ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/content", summary: "Propose a content change", tags: [T.adminContent], auth: "admin", duty: "propose_content_change", request: proposeContentChangeSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/content/versions/:id/decide", summary: "Decide a content version", tags: [T.adminContent], auth: "admin", duty: "decide_content_change", request: decideContentChangeSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/content/versions/:id/translations", summary: "Propose a translation for a version", tags: [T.adminContent], auth: "admin", duty: "propose_content_translation", request: proposeContentTranslationSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/content/translations/:id/decide", summary: "Decide a translation", tags: [T.adminContent], auth: "admin", duty: "decide_content_translation", request: decideContentTranslationSchema, ...hw(S.entity) },
  {
    method: "GET",
    path: "/v1/admin/incidents/dlq",
    summary: "Dead-letter queue",
    tags: [T.adminIncidents],
    auth: "admin",
    duty: "replay_job",
    query: [
      { name: "queue", schema: { type: "string" } },
      { name: "replayed", schema: { type: "string", enum: ["true", "false"] } },
    ],
    ...hw(S.itemsOf(S.entity)),
  },
  { method: "POST", path: "/v1/admin/jobs/:id/replay", summary: "Replay a dead-lettered job", tags: [T.adminIncidents], auth: "admin", duty: "replay_job", ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/incidents/shares/:shareLinkId/revoke", summary: "Incident-response revoke of a share link", tags: [T.adminIncidents], auth: "admin", duty: "revoke_share", request: adminRevokeShareSchema, ...hw(S.shareRevoked) },
  {
    method: "GET",
    path: "/v1/admin/operations/summary",
    summary: "Operations summary (jobs, DLQ, notifications, backups)",
    tags: [T.adminOperations],
    auth: "admin",
    duty: "view_operations",
    query: [{ name: "windowHours", schema: { type: "integer", minimum: 1 }, description: "Look-back window; clamped server-side." }],
    ...hw(S.anyObject),
  },
  { method: "GET", path: "/v1/admin/operations/medication-stats", summary: "Medication usage statistics", tags: [T.adminOperations], auth: "admin", duty: "view_operations", ...hw(S.anyObject) },
  { method: "GET", path: "/v1/admin/rules", summary: "Safety rule catalogue", tags: [T.adminRules], auth: "admin", duty: "view_rules", ...hw(S.itemsOf(S.anyObject)) },
  { method: "GET", path: "/v1/admin/findings", summary: "Search safety findings", tags: [T.adminRules], auth: "admin", duty: "view_rules", query: adminFindingsSearchSchema, ...hw(S.pageOf(S.entity)) },
  { method: "GET", path: "/v1/admin/findings/:id", summary: "Safety finding detail", tags: [T.adminRules], auth: "admin", duty: "view_rules", ...hw(S.entity) },
  { method: "GET", path: "/v1/admin/users/overview", summary: "User info + onboarding funnel", tags: [T.adminUsers], auth: "admin", duty: "view_users", ...hw(S.anyObject) },

  // ───────────────────────── Admin: Providers ─────────────────────────
  { method: "GET", path: "/v1/admin/organizations", summary: "Organization directory", description: "Global entries in full; patient-entered rows as `{ id, patientScoped: true, kind, verification, counts }` only. `q` matches global entries only.", tags: [T.adminProviders], auth: "admin", duty: "manage_providers", query: adminOrganizationsQuerySchema, ...hw(S.pageOf(S.entity)) },
  { method: "POST", path: "/v1/admin/organizations", summary: "Create a global organization entry", tags: [T.adminProviders], auth: "admin", duty: "manage_providers", request: adminCreateOrganizationSchema, ...hw(S.entity) },
  { method: "PATCH", path: "/v1/admin/organizations/:id", summary: "Update a global organization entry", tags: [T.adminProviders], auth: "admin", duty: "manage_providers", request: adminUpdateOrganizationSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/organizations/:id/verify", summary: "Record the HFR id and mark provider-verified", tags: [T.adminProviders], auth: "admin", duty: "manage_providers", request: adminVerifyOrganizationSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/organizations/:id/merge", summary: "Merge a global organization into another", tags: [T.adminProviders], auth: "admin", duty: "manage_providers", request: mergeOrganizationSchema, ...hw(S.entity) },
  { method: "GET", path: "/v1/admin/practitioners", summary: "Practitioner directory", description: "Global entries in full; patient-entered rows as `{ id, patientScoped: true, verification, counts }` only.", tags: [T.adminProviders], auth: "admin", duty: "manage_providers", query: adminPractitionersQuerySchema, ...hw(S.pageOf(S.entity)) },
  { method: "POST", path: "/v1/admin/practitioners/:id/verify", summary: "Record the HPR id and mark provider-verified", tags: [T.adminProviders], auth: "admin", duty: "manage_providers", request: adminVerifyPractitionerSchema, ...hw(S.entity) },

  // ───────────────────────── Profiles ─────────────────────────
  { method: "GET", path: "/v1/profiles", summary: "Profiles the caller can act on", tags: [T.profiles], auth: "patient", ...hw(S.itemsOf(S.profile)) },
  { method: "POST", path: "/v1/profiles", summary: "Create the caller's self profile", tags: [T.profiles], auth: "patient", request: createSelfProfileSchema, ...hw(S.versionedEntity) },
  { method: "POST", path: "/v1/profiles/dependents", summary: "Create a dependent profile", tags: [T.profiles], auth: "patient", request: createDependentSchema, ...hw(S.versionedEntity) },
  { method: "GET", path: "/v1/profiles/current", summary: "Active profile", tags: [T.profiles], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.versionedEntity) },
  { method: "PATCH", path: "/v1/profiles/current", summary: "Update the active profile", tags: [T.profiles], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateProfileSchema, ...hw(S.versionedEntity) },
  { method: "GET", path: "/v1/profiles/current/allergies", summary: "List allergies", tags: [T.profiles], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/allergies", summary: "Add an allergy", tags: [T.profiles], auth: "patient", headers: [PROFILE, CLIENT], scope: "edit_profile", request: allergySchema, ...hw(S.entity) },
  { method: "GET", path: "/v1/profiles/current/conditions", summary: "List conditions", tags: [T.profiles], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/conditions", summary: "Add a condition", tags: [T.profiles], auth: "patient", headers: [PROFILE, CLIENT], scope: "edit_profile", request: conditionSchema, ...hw(S.entity) },

  // ───────────────────────── Caregivers ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/caregivers", summary: "Caregivers of the active profile", tags: [T.caregivers], auth: "patient", headers: [PROFILE], scope: "manage_caregivers", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/caregivers", summary: "Invite a caregiver", tags: [T.caregivers], auth: "patient", stepUp: true, headers: [PROFILE], scope: "manage_caregivers", request: inviteCaregiverSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/caregivers/accept", summary: "Accept a caregiver invitation", tags: [T.caregivers], auth: "patient", request: acceptInviteSchema, ...hw(S.entity) },
  { method: "PATCH", path: "/v1/caregivers/:relationshipId/scopes", summary: "Change a caregiver's scopes", tags: [T.caregivers], auth: "patient", stepUp: true, headers: [PROFILE], scope: "manage_caregivers", request: updateCaregiverScopesSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/caregivers/:relationshipId", summary: "Revoke a caregiver", tags: [T.caregivers], auth: "patient", stepUp: true, headers: [PROFILE], scope: "manage_caregivers" },
  { method: "GET", path: "/v1/caregivers/invitations", summary: "Invitations addressed to the caller's phone", tags: [T.caregivers], auth: "patient", ...hw(S.itemsOf(S.entity)) },
  { method: "GET", path: "/v1/caregivers/:relationshipId/accesses", summary: "Access log for one caregiver relationship", tags: [T.caregivers], auth: "patient", headers: [PROFILE], scope: "manage_caregivers", ...hw(S.itemsOf(S.anyObject)) },
  {
    method: "GET",
    path: "/v1/profiles/current/family",
    summary: "Family dashboard: every profile the caller can act on, with a per-profile summary",
    description: "Not scoped by `x-profile-id`. Each item carries the caller's relationship and scopes; summary fields the caller's scopes do not grant are null. `nextTestDue` is a placeholder (null) until TestDueSchedule ships.",
    tags: [T.caregivers],
    auth: "patient",
    ...hw(S.itemsOf(S.familyProfile)),
  },
  { method: "GET", path: "/v1/profiles/current/activity", summary: "Who changed what: caregiver-authored timeline events and audit rows, newest first", tags: [T.caregivers], auth: "patient", headers: [PROFILE], scope: "view_profile", query: activityQuerySchema, ...hw(S.pageOf(S.activityItem)) },

  // ───────────────────────── Claims ─────────────────────────
  { method: "POST", path: "/v1/profiles/current/claim-invite", summary: "Invite the dependent to claim their profile", tags: [T.claims], auth: "patient", headers: [PROFILE], scope: "manage_claim", request: claimInviteSchema, ...hw({ type: "object", required: ["id", "status"], properties: { id: { type: "string", format: "uuid" }, status: { type: "string", enum: ["invited"] } } }) },
  { method: "DELETE", path: "/v1/profiles/current/claim-invite", summary: "Withdraw the claim invitation", tags: [T.claims], auth: "patient", headers: [PROFILE], scope: "manage_claim" },
  { method: "GET", path: "/v1/profiles/claim-invitations", summary: "Claim invitations addressed to the caller", tags: [T.claims], auth: "patient", ...hw(S.itemsOf({ type: "object", required: ["profileId", "displayName"], properties: { profileId: { type: "string", format: "uuid" }, displayName: { type: "string" }, yearOfBirth: { type: ["integer", "null"] } } })) },
  { method: "POST", path: "/v1/profiles/claim", summary: "Claim a profile as your own", tags: [T.claims], auth: "patient", request: claimProfileSchema, ...hw({ type: "object", required: ["id", "displayName"], properties: { id: { type: "string", format: "uuid" }, displayName: { type: "string" } } }) },

  // ───────────────────────── Consents ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/consents", summary: "List consents", tags: [T.consents], auth: "patient", headers: [PROFILE], scope: "manage_consents", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/consents", summary: "Grant a consent", tags: [T.consents], auth: "patient", headers: [PROFILE], scope: "manage_consents", request: grantConsentSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/consents/:id/revoke", summary: "Revoke a consent", tags: [T.consents], auth: "patient", headers: [PROFILE], scope: "manage_consents", ...hw(S.entity) },

  // ───────────────────────── Catalog ─────────────────────────
  { method: "GET", path: "/v1/catalog/products", summary: "Search the medication catalog", tags: [T.catalog], auth: "patient", rateLimit: "catalog_search", query: catalogSearchSchema, ...hw(S.itemsOf(S.entity)) },
  { method: "GET", path: "/v1/catalog/products/:id", summary: "Catalog product detail", tags: [T.catalog], auth: "patient", ...hw(S.entity) },

  // ───────────────────────── Documents / dev storage ─────────────────────────
  {
    method: "POST",
    path: "/v1/profiles/current/documents/authorize-upload",
    summary: "Authorize a document upload (presigned PUT)",
    tags: [T.documents],
    auth: "patient",
    rateLimit: "document_upload",
    headers: [PROFILE],
    scope: "add_medications | edit_profile",
    request: authorizeUploadSchema,
    ...hw(S.uploadAuthorization),
  },
  { method: "POST", path: "/v1/documents/:id/complete", summary: "Mark an upload complete (verify + scan)", tags: [T.documents], auth: "patient", headers: [PROFILE], scope: "add_medications | edit_profile", ...hw(S.documentStatus) },
  { method: "GET", path: "/v1/documents/:id/download-url", summary: "Short-lived download URL", tags: [T.documents], auth: "patient", headers: [PROFILE], scope: "view_medications | view_profile", ...hw(S.downloadUrl) },
  { method: "GET", path: "/v1/profiles/current/documents", summary: "List documents", tags: [T.documents], auth: "patient", headers: [PROFILE], scope: "view_medications | view_profile", ...hw(S.itemsOf(S.documentRow)) },
  {
    method: "PUT",
    path: "/v1/dev-storage/:token",
    summary: "Dev-only presigned upload sink (local-disk R2 stand-in)",
    description: "Exists only where object storage is the local-disk stand-in; the HMAC token in the path is the authorization, like a presigned URL.",
    tags: [T.documents],
    auth: "share-token",
    ...hw(S.okResponse),
  },
  {
    method: "GET",
    path: "/v1/dev-storage/:token",
    summary: "Dev-only presigned download (local-disk R2 stand-in)",
    tags: [T.documents],
    auth: "share-token",
    ...hw([{ status: 200, schema: { type: "string", format: "binary" }, contentType: "application/octet-stream", description: "The stored object bytes." }]),
  },

  // ───────────────────── Documents V2 (docs_v2/05 §5) ─────────────────────
  // Served under `patient-documents` / `document-candidates` /
  // `document-extractions` so V1's single-object `documents/*` routes above
  // keep working unchanged until their V2.5 sunset (docs_v2/05 §15).
  {
    method: "POST",
    path: "/v1/profiles/current/patient-documents",
    summary: "Create a multi-page document and authorize its page uploads",
    description:
      "Returns one presigned upload per requested page, in page order. A `kind` sent here is the patient's own choice and outranks the classifier permanently (docs_v2/09 §4).",
    tags: [T.documentsV2],
    auth: "patient",
    rateLimit: "document_upload",
    headers: [PROFILE, CLIENT],
    scope: "edit_profile",
    request: createDocumentV2Schema,
    ...hw(S.documentV2Created),
  },
  {
    method: "GET",
    path: "/v1/profiles/current/patient-documents",
    summary: "List documents (cursor)",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE],
    scope: "view_profile",
    query: documentListQuerySchema,
    ...hw(S.documentV2List),
  },
  {
    method: "GET",
    path: "/v1/patient-documents/:id",
    summary: "One document: pages with short-lived download URLs, classification, latest extraction",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE],
    scope: "view_profile",
    ...hw(S.documentV2),
  },
  {
    method: "PATCH",
    path: "/v1/patient-documents/:id",
    summary: "Override the kind, title, date or links",
    description: "A `kind` set here becomes `classifiedBy: \"user\"` and no later classification run may move it (docs_v2/09 §4, H-34).",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE, CLIENT],
    scope: "edit_profile",
    request: updateDocumentV2Schema,
    ...hw(S.documentV2),
  },
  {
    method: "DELETE",
    path: "/v1/patient-documents/:id",
    summary: "Soft-delete a document (the stored originals are kept)",
    description: "docs_v2/09 §1 rule 1: the original pages are retained and removed only by the retention policy.",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE],
    scope: "edit_profile",
  },
  {
    method: "POST",
    path: "/v1/patient-documents/:id/pages/authorize-upload",
    summary: "Add more pages to an existing document",
    tags: [T.documentsV2],
    auth: "patient",
    rateLimit: "document_upload",
    headers: [PROFILE],
    scope: "edit_profile",
    request: authorizeDocumentPagesSchema,
    ...hw(S.documentV2Page_upload),
  },
  {
    method: "POST",
    path: "/v1/patient-documents/:id/pages/:pageNumber/complete",
    summary: "Verify one uploaded page (magic bytes + sha256)",
    description:
      "Bumps `pageCount`; when the last authorized page lands the document becomes `uploaded` and one `document_classify` job is enqueued for the whole document.",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE],
    scope: "edit_profile",
    ...hw(S.documentV2PageCompleted),
  },
  {
    method: "POST",
    path: "/v1/patient-documents/:id/process",
    summary: "Re-run classification and extraction",
    description: "Idempotent by page content hash plus engine version.",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE],
    scope: "edit_profile",
    ...hw(S.documentV2),
  },
  {
    method: "GET",
    path: "/v1/patient-documents/:id/extraction",
    summary: "Extraction candidates, grouped by target entity and source line",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE],
    scope: "view_profile",
    ...hw(S.documentExtraction),
  },
  {
    method: "POST",
    path: "/v1/document-candidates/:id/confirm",
    summary: "Confirm (optionally correct) one candidate",
    description:
      "The one path that turns a proposal into a clinical row (docs_v2/09 §1 rule 3). A medicine additionally needs a typed dose — dose is never read from a photo (H-02).",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE, CLIENT],
    scope: "add_medications",
    request: confirmDocumentCandidateSchema,
    ...hw(S.candidateDecision),
  },
  {
    method: "POST",
    path: "/v1/document-candidates/:id/reject",
    summary: "Dismiss a candidate",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE],
    scope: "add_medications",
    request: rejectDocumentCandidateSchema,
    requestOptional: true,
    ...hw(S.candidateDecision),
  },
  {
    method: "POST",
    path: "/v1/document-extractions/:id/materialize",
    summary: "Batch-confirm candidates into clinical rows",
    description: "Structural rows (prescription, report, doctor, clinic) land in one transaction; medicines follow, so they attach to the record the same batch created.",
    tags: [T.documentsV2],
    auth: "patient",
    headers: [PROFILE, IDEMPOTENCY, CLIENT],
    scope: "add_medications",
    request: materializeExtractionSchema,
    ...hw(S.materializedRows),
  },

  // ───────────────────────── Extraction ─────────────────────────
  { method: "POST", path: "/v1/documents/:id/process", summary: "Queue OCR/extraction for a document", tags: [T.extraction], auth: "patient", headers: [PROFILE], scope: "add_medications", ...hw(S.anyObject) },
  { method: "GET", path: "/v1/documents/:id/extraction", summary: "Extraction candidates for a document", tags: [T.extraction], auth: "patient", headers: [PROFILE], scope: "view_medications", ...hw(S.anyObject) },
  { method: "POST", path: "/v1/extraction-candidates/:id/confirm", summary: "Confirm (optionally correct) a candidate", tags: [T.extraction], auth: "patient", headers: [PROFILE], scope: "add_medications", request: confirmCandidateSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/extraction-candidates/:id/reject", summary: "Reject a candidate", tags: [T.extraction], auth: "patient", headers: [PROFILE], scope: "add_medications", request: rejectCandidateSchema, requestOptional: true, ...hw(S.anyObject) },
  {
    method: "POST",
    path: "/v1/extractions/:id/create-medication",
    summary: "Create a medication from an extraction",
    description: "Dose fields always come from the patient (docs/09 §6), never from OCR. Idempotent per `idempotency-key`.",
    tags: [T.extraction],
    auth: "patient",
    headers: [PROFILE, IDEMPOTENCY],
    scope: "add_medications",
    request: createMedicationFromExtractionSchema,
    ...hw(S.versionedEntity),
  },

  // ───────────────────────── Glucose / checkups ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/glucose-readings", summary: "List glucose readings", tags: [T.glucose], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/glucose-readings", summary: "Record a glucose reading", tags: [T.glucose], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: glucoseReadingSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/glucose-readings/:id", summary: "Delete a glucose reading", tags: [T.glucose], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/profiles/current/checkup-records", summary: "List checkup records", tags: [T.glucose], auth: "patient", headers: [PROFILE], scope: "view_profile", deprecated: true, ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/checkup-records", summary: "Record a checkup", tags: [T.glucose], auth: "patient", headers: [PROFILE], scope: "edit_profile", deprecated: true, request: checkupRecordSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/checkup-records/:id", summary: "Delete a checkup record", tags: [T.glucose], auth: "patient", headers: [PROFILE], scope: "edit_profile", deprecated: true },

  // ───────────────────────── Vitals ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/blood-pressure-readings", summary: "List blood-pressure readings", tags: [T.vitals], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/blood-pressure-readings", summary: "Record a blood-pressure reading", tags: [T.vitals], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: bloodPressureReadingSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/blood-pressure-readings/:id", summary: "Delete a blood-pressure reading", tags: [T.vitals], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/profiles/current/weight-readings", summary: "List weight readings", tags: [T.vitals], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/weight-readings", summary: "Record a weight reading", tags: [T.vitals], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: weightReadingSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/weight-readings/:id", summary: "Delete a weight reading", tags: [T.vitals], auth: "patient", headers: [PROFILE], scope: "edit_profile" },

  // ───────────────────────── Leads ─────────────────────────
  { method: "POST", path: "/v1/public/leads", summary: "Marketing-site lead capture", tags: [T.leads], auth: "public", rateLimit: "lead_submit", request: createLeadSchema, ...hw(S.entity) },

  // ───────────────────────── Medications ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/medications", summary: "List medications", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "view_medications", query: statusQuery, ...hw(S.itemsOf(S.versionedEntity)) },
  { method: "POST", path: "/v1/profiles/current/medications", summary: "Add a medication", tags: [T.medications], auth: "patient", headers: [PROFILE, IDEMPOTENCY], scope: "add_medications", request: createMedicationSchema, ...hw(S.versionedEntity) },
  { method: "GET", path: "/v1/medications/:id", summary: "Medication detail", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "view_medications", ...hw(S.versionedEntity) },
  { method: "PATCH", path: "/v1/medications/:id", summary: "Update a medication (rowVersion-checked)", tags: [T.medications], auth: "patient", headers: [PROFILE, IDEMPOTENCY], scope: "edit_medications", request: updateMedicationSchema, ...hw(S.versionedEntity) },
  { method: "POST", path: "/v1/medications/:id/confirm-dose-unit", summary: "Confirm an ambiguous dose unit", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "edit_medications", request: confirmDoseUnitSchema, ...hw(S.versionedEntity) },
  { method: "POST", path: "/v1/medications/:id/status", summary: "Change medication status (pause/stop/resume)", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "edit_medications", request: changeMedicationStatusSchema, ...hw(S.versionedEntity) },
  { method: "POST", path: "/v1/medications/:id/refill", summary: "Record a refill", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "edit_medications", request: recordRefillSchema, ...hw(S.versionedEntity) },
  { method: "GET", path: "/v1/medications/:id/refill-plan", summary: "Refill plan: what the patient holds, and when it runs out at the confirmed schedule's rate", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "view_medications", ...hw(S.anyObject) },
  { method: "PUT", path: "/v1/medications/:id/refill-plan", summary: "Set pack size and quantity on hand", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "edit_medications", request: putRefillPlanSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/medications/:id/history", summary: "Medication change history", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "view_medications", ...hw(S.itemsOf(S.anyObject)) },
  { method: "DELETE", path: "/v1/medications/:id", summary: "Soft-delete a medication", tags: [T.medications], auth: "patient", headers: [PROFILE], scope: "edit_medications" },

  // ───────────────────────── Notifications ─────────────────────────
  { method: "GET", path: "/v1/push/vapid-public-key", summary: "Web Push VAPID public key", tags: [T.notifications], auth: "public", ...hw(S.vapidPublicKey) },
  { method: "POST", path: "/v1/notification-channels/web-push", summary: "Subscribe this device to Web Push", tags: [T.notifications], auth: "patient", request: webPushSubscribeSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/notification-channels/web-push/unsubscribe", summary: "Unsubscribe from Web Push", tags: [T.notifications], auth: "patient", request: webPushUnsubscribeSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/profiles/current/notification-preferences", summary: "Notification preferences", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "manage_reminders", ...hw(S.anyObject) },
  { method: "POST", path: "/v1/profiles/current/notification-preferences", summary: "Update notification preferences", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "manage_reminders", request: notificationPreferencesSchema, ...hw(S.anyObject) },
  { method: "PUT", path: "/v1/profiles/current/notification-preferences", summary: "Replace notification preferences, including per-kind channel/frequency controls", description: "`channelFrequency` maps a NotificationKind to `{channels[], frequency}`. `dose_reminder` and `caregiver_escalation` are refused (they can never be turned down). Omitting `channelFrequency` leaves it unchanged.", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "manage_reminders", request: notificationPreferencesSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/profiles/current/refill-reminders", summary: "Open refill reminders", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "view_medications", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/refill-reminders/:notificationId/dismiss", summary: "Dismiss a refill reminder", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "edit_medications", ...hw(S.anyObject) },
  { method: "GET", path: "/v1/profiles/current/caregiver-alerts", summary: "Recent caregiver alerts (missed doses)", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "manage_reminders", ...hw(S.itemsOf(S.anyObject)) },

  // ───────────────────────── Webhooks ─────────────────────────
  {
    method: "POST",
    path: "/v1/webhooks/telnyx/sms",
    summary: "Telnyx SMS delivery-status callback",
    description: "Verified with `telnyx-signature-ed25519` + `telnyx-timestamp` over the raw body. Always 200 once verified.",
    tags: [T.webhooks],
    auth: "webhook",
    rateLimit: "telnyx_webhook",
    headers: ["telnyx-signature-ed25519", "telnyx-timestamp"],
    ...hw(S.anyObject),
  },
  {
    method: "POST",
    path: "/v1/webhooks/telnyx/voice",
    summary: "Telnyx voice-call event callback",
    tags: [T.webhooks],
    auth: "webhook",
    rateLimit: "telnyx_voice_webhook",
    headers: ["telnyx-signature-ed25519", "telnyx-timestamp"],
    ...hw(S.anyObject),
  },

  // ───────────────────────── Practitioners ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/practitioners", summary: "List practitioners", tags: [T.practitioners], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/practitioners", summary: "Add a practitioner", tags: [T.practitioners], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: createPractitionerSchema, ...hw(S.entity) },
  { method: "PATCH", path: "/v1/practitioners/:id", summary: "Update a practitioner", tags: [T.practitioners], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updatePractitionerSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/practitioners/:id/merge", summary: "Merge into another practitioner", tags: [T.practitioners], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: mergePractitionerSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/practitioners/:id", summary: "Delete a practitioner", tags: [T.practitioners], auth: "patient", headers: [PROFILE], scope: "edit_profile" },

  // ───────────────────────── Prescriptions ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/prescriptions", summary: "List prescriptions", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/prescriptions", summary: "Create a prescription record", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: createPrescriptionSchema, ...hw(S.entity) },
  { method: "GET", path: "/v1/prescriptions/:id", summary: "Prescription detail", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.entity) },
  { method: "POST", path: "/v1/prescriptions/:id/medications", summary: "Link a medication to a prescription", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: linkMedicationSchema, ...hw(S.entity) },
  { method: "GET", path: "/v1/prescriptions/:id/items", summary: "Line items as written on the prescription", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.anyObject)) },
  { method: "POST", path: "/v1/prescriptions/:id/items", summary: "Add a line item", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: prescriptionItemSchema, ...hw(S.anyObject) },
  { method: "PATCH", path: "/v1/prescription-items/:itemId", summary: "Correct a line item", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updatePrescriptionItemSchema, ...hw(S.anyObject) },
  { method: "DELETE", path: "/v1/prescription-items/:itemId", summary: "Remove a line item", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "POST", path: "/v1/prescription-items/:itemId/start-medication", summary: "Start a prescribed line as one of the patient's medicines", tags: [T.prescriptions], auth: "patient", headers: [PROFILE, IDEMPOTENCY], scope: "add_medications", request: startMedicationFromItemSchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/prescriptions/:id", summary: "Delete a prescription record", tags: [T.prescriptions], auth: "patient", headers: [PROFILE], scope: "edit_profile" },

  // ───────────────────────── Reports (V1 façade, see docs_v2/05 §15) ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/reports", summary: "List test reports", tags: [T.reports], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/reports", summary: "Create a test report", tags: [T.reports], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: createReportSchema, ...hw(S.entity) },
  { method: "GET", path: "/v1/reports/:id", summary: "Report detail with values", tags: [T.reports], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.entity) },
  { method: "POST", path: "/v1/reports/:id/values", summary: "Add a transcribed value to a report", tags: [T.reports], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: addReportValueSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/report-values/:id", summary: "Delete a report value", tags: [T.reports], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/profiles/current/report-values", summary: "Value history for one analyte", tags: [T.reports], auth: "patient", headers: [PROFILE], scope: "view_profile", query: reportValueHistoryQuerySchema, ...hw(S.itemsOf(S.anyObject)) },
  { method: "DELETE", path: "/v1/reports/:id", summary: "Delete a test report", tags: [T.reports], auth: "patient", headers: [PROFILE], scope: "edit_profile" },

  // ───────────────────────── Diagnostics (docs_v2/05 §6) ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/diagnostic-reports", summary: "List diagnostic reports", tags: [T.diagnostics], auth: "patient", headers: [PROFILE], scope: "view_profile", query: diagnosticReportsQuerySchema, ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/diagnostic-reports", summary: "File a diagnostic report", tags: [T.diagnostics], auth: "patient", headers: [PROFILE, CLIENT], scope: "edit_profile", request: createDiagnosticReportSchema, ...hw(S.entity) },
  { method: "GET", path: "/v1/diagnostic-reports/:id", summary: "Diagnostic report with its results", tags: [T.diagnostics], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.entity) },
  { method: "PATCH", path: "/v1/diagnostic-reports/:id", summary: "Correct a diagnostic report", tags: [T.diagnostics], auth: "patient", headers: [PROFILE, CLIENT], scope: "edit_profile", request: updateDiagnosticReportSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/diagnostic-reports/:id", summary: "Delete a diagnostic report", tags: [T.diagnostics], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/diagnostic-reports/:id/results", summary: "Results on one report", tags: [T.diagnostics], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/diagnostic-reports/:id/results", summary: "Add a result to a report", description: "`interpretation` is refused with `interpretation_not_client_settable` unless the write is on a provider path (docs_v2/04 §6.3).", tags: [T.diagnostics], auth: "patient", headers: [PROFILE, CLIENT], scope: "edit_profile", request: addDiagnosticResultSchema, ...hw(S.entity) },
  { method: "PATCH", path: "/v1/diagnostic-results/:id", summary: "Correct a result", description: "Writes a superseding row and points the original at it; the original is immutable (docs_v2/04 §6.3).", tags: [T.diagnostics], auth: "patient", headers: [PROFILE, CLIENT], scope: "edit_profile", request: correctDiagnosticResultSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/diagnostic-results/:id", summary: "Delete a result", tags: [T.diagnostics], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/profiles/current/diagnostic-results", summary: "Results across every report", tags: [T.diagnostics], auth: "patient", headers: [PROFILE], scope: "view_profile", query: diagnosticResultsQuerySchema, ...hw(S.itemsOf(S.anyObject)) },
  { method: "GET", path: "/v1/profiles/current/trends/results/:analyteKey", summary: "One analyte's series in its canonical unit", description: "Points that cannot be converted are returned in `unconvertible[]` rather than mixed into `points` (hazard H-35/H-39).", tags: [T.diagnostics], auth: "patient", headers: [PROFILE], scope: "view_profile", query: resultTrendQuerySchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/terminology/analytes", summary: "Analyte vocabulary with LOINC codes and units", description: "Static code table, identical for every caller and free of PHI — public so unit pickers and OCR mapping work before sign-in.", tags: [T.terminology], auth: "public", ...hw(S.anyObject) },
  { method: "GET", path: "/v1/terminology/observation-concepts", summary: "Observation concepts with LOINC codes, units and plausibility ranges", tags: [T.terminology], auth: "public", ...hw(S.anyObject) },

  // ───────────────────────── Observations (docs_v2/05 §7) ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/observations", summary: "List measurements", tags: [T.observations], auth: "patient", headers: [PROFILE], scope: "view_measurements", query: observationsQuerySchema, ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/observations", summary: "Record a measurement", description: "Blood pressure uses `valueNumeric`/`valueNumeric2`; a `pulseBpm` sent with it becomes its own `heart_rate` observation.", tags: [T.observations], auth: "patient", headers: [PROFILE, CLIENT], scope: "add_measurements", request: observationSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/profiles/current/observations/batch", summary: "Device sync: many measurements at once", description: "Deduped on `(concept, measuredAt, deviceId)` against stored rows and within the batch.", tags: [T.observations], auth: "patient", headers: [PROFILE, CLIENT], scope: "add_measurements", request: observationBatchSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/profiles/current/trends/observations/:concept", summary: "Descriptive trend for one concept", description: "Rolling average, min/max and a morning/evening split cut on the patient's own clock. Never an interpretation (hazard H-25).", tags: [T.observations], auth: "patient", headers: [PROFILE], scope: "view_measurements", query: observationTrendQuerySchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/observations/:id", summary: "One measurement", tags: [T.observations], auth: "patient", headers: [PROFILE], scope: "view_measurements", ...hw(S.entity) },
  { method: "DELETE", path: "/v1/observations/:id", summary: "Delete a measurement", tags: [T.observations], auth: "patient", headers: [PROFILE], scope: "add_measurements" },
  { method: "GET", path: "/v1/profiles/current/measurement-devices", summary: "List measurement devices", tags: [T.observations], auth: "patient", headers: [PROFILE], scope: "view_measurements", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/measurement-devices", summary: "Register a measurement device", tags: [T.observations], auth: "patient", headers: [PROFILE, CLIENT], scope: "add_measurements", request: measurementDeviceSchema, ...hw(S.entity) },
  { method: "PATCH", path: "/v1/measurement-devices/:id", summary: "Update a measurement device", tags: [T.observations], auth: "patient", headers: [PROFILE, CLIENT], scope: "add_measurements", request: updateMeasurementDeviceSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/measurement-devices/:id", summary: "Retire a measurement device", description: "Soft-delete; the readings it produced stay — they are the patient's measurements, not the meter's.", tags: [T.observations], auth: "patient", headers: [PROFILE], scope: "add_measurements" },

  // ───────────────────────── Safety ─────────────────────────
  { method: "POST", path: "/v1/profiles/current/safety/evaluate", summary: "Run the safety rules now", tags: [T.safety], auth: "patient", headers: [PROFILE], scope: "review_concerns", ...hw(S.anyObject) },
  { method: "GET", path: "/v1/profiles/current/safety/findings", summary: "Findings from the latest evaluation", tags: [T.safety], auth: "patient", headers: [PROFILE], scope: "review_concerns", query: statusQuery, ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/findings/:id/actions", summary: "Record an action on a finding", tags: [T.safety], auth: "patient", headers: [PROFILE], scope: "review_concerns", request: recordFindingActionSchema, ...hw(S.entity) },

  // ───────────────────────── Scheduling ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/timeline", summary: "Dose timeline for a day", tags: [T.scheduling], auth: "patient", headers: [PROFILE], scope: "view_schedule", query: timelineQuerySchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/doses/:scheduledDoseId/events", summary: "Record a dose event (taken/skipped/snoozed…)", tags: [T.scheduling], auth: "patient", headers: [PROFILE], scope: "record_doses", request: recordDoseEventSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/profiles/current/doses/prn-events", summary: "Record an as-needed (PRN) dose", tags: [T.scheduling], auth: "patient", headers: [PROFILE], scope: "record_doses", request: recordPrnDoseEventSchema, ...hw(S.entity) },

  // ───────────────────────── Clinical profile (docs_v2/05 §2) ─────────────────────────
  { method: "PATCH", path: "/v1/allergies/:id", summary: "Update an allergy", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateAllergySchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/allergies/:id", summary: "Delete an allergy", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "PATCH", path: "/v1/conditions/:id", summary: "Update a condition", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateConditionSchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/conditions/:id", summary: "Delete a condition", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/profiles/current/immunizations", summary: "List immunizations", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.versionedEntity)) },
  { method: "POST", path: "/v1/profiles/current/immunizations", summary: "Add an immunization", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: createImmunizationSchema, ...hw(S.versionedEntity) },
  { method: "PATCH", path: "/v1/immunizations/:id", summary: "Update an immunization", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateImmunizationSchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/immunizations/:id", summary: "Delete an immunization", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/profiles/current/procedures", summary: "List procedures", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.versionedEntity)) },
  { method: "POST", path: "/v1/profiles/current/procedures", summary: "Add a procedure", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: createProcedureSchema, ...hw(S.versionedEntity) },
  { method: "PATCH", path: "/v1/procedures/:id", summary: "Update a procedure", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateProcedureSchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/procedures/:id", summary: "Delete a procedure", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/profiles/current/family-history", summary: "List family history", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.versionedEntity)) },
  { method: "POST", path: "/v1/profiles/current/family-history", summary: "Add a family-history entry", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: createFamilyHistorySchema, ...hw(S.versionedEntity) },
  { method: "PATCH", path: "/v1/family-history/:id", summary: "Update a family-history entry", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateFamilyHistorySchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/family-history/:id", summary: "Delete a family-history entry", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile" },
  { method: "GET", path: "/v1/profiles/current/emergency-contacts", summary: "List emergency contacts", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.versionedEntity)) },
  { method: "POST", path: "/v1/profiles/current/emergency-contacts", summary: "Add an emergency contact", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: createEmergencyContactSchema, ...hw(S.versionedEntity) },
  { method: "PATCH", path: "/v1/emergency-contacts/:id", summary: "Update an emergency contact", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateEmergencyContactSchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/emergency-contacts/:id", summary: "Delete an emergency contact", tags: [T.clinicalProfile], auth: "patient", headers: [PROFILE], scope: "edit_profile" },

  // ───────────────────────── Organizations (docs_v2/05 §2) ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/organizations", summary: "List patient-scoped organizations", tags: [T.organizations], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.versionedEntity)) },
  { method: "POST", path: "/v1/profiles/current/organizations", summary: "Add an organization", tags: [T.organizations], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: createOrganizationSchema, ...hw(S.versionedEntity) },
  { method: "PATCH", path: "/v1/organizations/:id", summary: "Update an organization", tags: [T.organizations], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateOrganizationSchema, ...hw(S.versionedEntity) },
  { method: "POST", path: "/v1/organizations/:id/merge", summary: "Merge into another organization", tags: [T.organizations], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: mergeOrganizationSchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/organizations/:id", summary: "Delete an organization", tags: [T.organizations], auth: "patient", headers: [PROFILE], scope: "edit_profile" },

  // ───────────────────────── Encounters (docs_v2/05 §2) ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/encounters", summary: "List encounters", tags: [T.encounters], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.itemsOf(S.versionedEntity)) },
  { method: "POST", path: "/v1/profiles/current/encounters", summary: "Record an encounter", tags: [T.encounters], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: encounterSchema, ...hw(S.versionedEntity) },
  { method: "GET", path: "/v1/encounters/:id", summary: "Encounter detail (with linked records)", tags: [T.encounters], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.versionedEntity) },
  { method: "PATCH", path: "/v1/encounters/:id", summary: "Update an encounter", tags: [T.encounters], auth: "patient", headers: [PROFILE], scope: "edit_profile", request: updateEncounterSchema, ...hw(S.versionedEntity) },
  { method: "DELETE", path: "/v1/encounters/:id", summary: "Soft-delete an encounter", tags: [T.encounters], auth: "patient", headers: [PROFILE], scope: "edit_profile" },

  // ───────────────────────── Health timeline (docs_v2/05 §3) ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/health-timeline", summary: "Unified health timeline, newest first", tags: [T.healthTimeline], auth: "patient", headers: [PROFILE], scope: "view_profile", query: healthTimelineQuerySchema, ...hw(S.pageOf(S.anyObject)) },
  { method: "GET", path: "/v1/profiles/current/health-timeline/summary", summary: "Per-kind counts for the home card", tags: [T.healthTimeline], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw({ type: "object", required: ["counts"], properties: { counts: { type: "object", additionalProperties: { type: "integer" } } } }) },

  // ───────────────────────── Sharing ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/visit-summary", summary: "Visit summary (JSON)", tags: [T.sharing], auth: "patient", headers: [PROFILE], scope: "share_records", ...hw(S.anyObject) },
  { method: "GET", path: "/v1/profiles/current/visit-summary/pdf", summary: "Visit summary as PDF", tags: [T.sharing], auth: "patient", headers: [PROFILE], scope: "share_records", ...hw(pdf("Rendered visit summary.")) },
  { method: "GET", path: "/v1/profiles/current/visit-summary/text", summary: "Visit summary as plain text (for WhatsApp etc.)", tags: [T.sharing], auth: "patient", headers: [PROFILE], scope: "share_records", query: visitSummaryTextQuerySchema, ...hw({ type: "object", required: ["text"], properties: { text: { type: "string" } } }) },
  { method: "GET", path: "/v1/profiles/current/doctor-snapshot", summary: "Doctor Snapshot: the concise clinician view (own profile)", tags: [T.sharing], auth: "patient", headers: [PROFILE], scope: "share_records", ...hw(S.anyObject) },
  { method: "POST", path: "/v1/profiles/current/shares", summary: "Create a time-boxed share link", tags: [T.sharing], auth: "patient", stepUp: true, headers: [PROFILE], scope: "share_records", request: createShareSchema, ...hw(S.shareCreated) },
  { method: "GET", path: "/v1/profiles/current/shares", summary: "List share links", tags: [T.sharing], auth: "patient", headers: [PROFILE], scope: "share_records", ...hw(S.itemsOf(S.entity)) },
  { method: "GET", path: "/v1/shares/:id/accesses", summary: "Access log of one share link", tags: [T.sharing], auth: "patient", headers: [PROFILE], scope: "share_records", ...hw(S.itemsOf(S.anyObject)) },
  { method: "POST", path: "/v1/shares/:id/revoke", summary: "Revoke a share link", tags: [T.sharing], auth: "patient", headers: [PROFILE], scope: "share_records", ...hw(S.shareRevoked) },
  {
    method: "GET",
    path: "/v1/public/shares/:token",
    summary: "Open a shared visit summary (recipient view)",
    description: "No session: the opaque token is the authorization. Every access is logged; response is `no-store`.",
    tags: [T.sharing],
    auth: "share-token",
    rateLimit: "share_access",
    ...hw(S.anyObject),
  },
  { method: "GET", path: "/v1/public/shares/:token/pdf", summary: "Shared visit summary as PDF", tags: [T.sharing], auth: "share-token", rateLimit: "share_access", ...hw(pdf("Rendered shared summary.")) },
  { method: "GET", path: "/v1/public/shares/:token/snapshot", summary: "Shared Doctor Snapshot (recipient view)", description: "Same frozen sections as the summary; every access is logged with `resource: snapshot`; response is `no-store`.", tags: [T.sharing], auth: "share-token", rateLimit: "share_access", ...hw(S.anyObject) },
  {
    method: "GET",
    path: "/v1/public/shares/:token/documents/:documentId/pages/:pageNumber",
    summary: "One page of a shared document: 302 to a short-lived signed URL",
    description: "Only when the share chose the `documents` section and the document belongs to the shared profile; otherwise an indistinguishable 404. Every attempt is recorded in the patient-visible access log.",
    tags: [T.sharing],
    auth: "share-token",
    rateLimit: "share_access",
    ...hw([{ status: 302, description: "Redirect to a signed page URL (minutes-lived, never stored)." }]),
  },

  // ───────────────────────── Sync ─────────────────────────
  {
    method: "POST",
    path: "/v1/sync",
    summary: "Replay queued offline mutations",
    description: "Each envelope names its own `profileId`; access is checked per mutation rather than via `x-profile-id`.",
    tags: [T.sync],
    auth: "patient",
    request: syncBatchSchema,
    ...hw(S.syncResult),
  },

  // ───────────────────────── Provider portal (V2 Phases 11–14) ─────────────────────────
  { method: "POST", path: "/v1/provider/auth/login", summary: "Provider sign-in step 1: request a phone OTP", description: "Enumeration-safe: the reply never says whether the number belongs to a provider. Email + TOTP is not offered yet (no TOTP secret storage on `User`).", tags: [T.providerAuth], auth: "public", rateLimit: "provider_login", request: providerLoginSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/provider/auth/totp", summary: "Provider sign-in step 2: verify the code, issue a provider session", description: "A correct code for a number that is not an active organization member is a `403 forbidden`. The token is a provider-type session (`mpp_…`), never accepted by patient or admin routes.", tags: [T.providerAuth], auth: "public", rateLimit: "provider_totp", request: providerTotpSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/provider/auth/session", summary: "Current provider session and organization memberships", tags: [T.providerAuth], auth: "provider", ...hw(S.anyObject) },
  { method: "POST", path: "/v1/provider/auth/logout", summary: "Revoke the provider session", tags: [T.providerAuth], auth: "provider" },

  { method: "GET", path: "/v1/provider/organizations/current", summary: "The organization this session acts for", tags: [T.providerOrganizations], auth: "provider", ...hw(S.anyObject) },
  { method: "PATCH", path: "/v1/provider/organizations/current", summary: "Update organization details (owner only)", tags: [T.providerOrganizations], auth: "provider", request: updateProviderOrganizationSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/provider/organizations/current/members", summary: "List members (owner only)", tags: [T.providerOrganizations], auth: "provider", ...hw(S.itemsOf(S.anyObject)) },
  { method: "POST", path: "/v1/provider/organizations/current/members", summary: "Add a member by phone (owner only)", description: "Creates the user as a provider account if the number is new; an existing patient account becomes `both`.", tags: [T.providerOrganizations], auth: "provider", request: addOrganizationMemberSchema, ...hw(S.anyObject) },
  { method: "PATCH", path: "/v1/provider/organizations/current/members/:memberId", summary: "Change a member's role or status (owner only)", description: "The last owner cannot be demoted or suspended.", tags: [T.providerOrganizations], auth: "provider", request: updateOrganizationMemberSchema, ...hw(S.anyObject) },
  { method: "DELETE", path: "/v1/provider/organizations/current/members/:memberId", summary: "Remove a member (owner only)", tags: [T.providerOrganizations], auth: "provider" },

  { method: "POST", path: "/v1/profiles/current/onboarding-tokens", summary: "Mint a QR onboarding token for a clinic to scan", description: "Short-lived (15m / 1h / 24h), single-use, hashed at rest like share tokens; names the sections the resulting provider link may read and how many days it stays open.", tags: [T.providerPatients], auth: "patient", stepUp: true, headers: [PROFILE], scope: "share_records", request: createOnboardingTokenSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/profiles/current/provider-links", summary: "Organizations holding a link to this profile", tags: [T.providerPatients], auth: "patient", headers: [PROFILE], scope: "share_records", ...hw(S.itemsOf(S.anyObject)) },
  { method: "POST", path: "/v1/provider-links/:id/revoke", summary: "Revoke a provider link", description: "Immediate: the organization's next read is a 404. Proposals it already sent stay decidable.", tags: [T.providerPatients], auth: "patient", stepUp: true, headers: [PROFILE], scope: "share_records", ...hw(S.anyObject) },
  { method: "POST", path: "/v1/provider/patients/onboard", summary: "Redeem a scanned QR token into a ProviderPatientLink", description: "Unknown, spent and expired tokens are an indistinguishable 404.", tags: [T.providerPatients], auth: "provider", request: onboardPatientSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/provider/patients", summary: "Linked patients (labels only, no clinical data)", tags: [T.providerPatients], auth: "provider", ...hw(S.itemsOf(S.anyObject)) },
  { method: "GET", path: "/v1/provider/patients/:linkId/snapshot", summary: "Doctor Snapshot within the link's granted sections", description: "Audited with the organization id on every read.", tags: [T.providerPatients], auth: "provider", ...hw(S.anyObject) },

  { method: "POST", path: "/v1/provider/patients/:linkId/reconciliations", summary: "Propose a medication reconciliation (clinic, hospital)", description: "Lines are START / CONTINUE / CHANGE / STOP. Stored as a proposal; nothing changes until the patient accepts.", tags: [T.providerProposals], auth: "provider", request: proposeReconciliationSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/provider/patients/:linkId/prescriptions", summary: "Propose a captured prescription (clinic, hospital)", description: "On acceptance the items become prescription line items with `source = clinic_entered` in the patient's confirmation queue.", tags: [T.providerProposals], auth: "provider", request: proposePrescriptionSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/provider/patients/:linkId/encounters", summary: "Propose an encounter record (clinic, hospital)", tags: [T.providerProposals], auth: "provider", request: proposeEncounterSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/provider/patients/:linkId/dispenses", summary: "Propose a dispense record (pharmacy only)", description: "On acceptance the medicine's supply and refill plan are updated from the dispensed quantity.", tags: [T.providerProposals], auth: "provider", request: proposeDispenseSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/provider/patients/:linkId/diagnostic-reports", summary: "Propose a diagnostic report with results (laboratory only)", description: "Lands `lab_imported` / `source_authenticated` on acceptance — the patient still chooses to include it.", tags: [T.providerProposals], auth: "provider", request: proposeDiagnosticReportSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/provider/patients/:linkId/discharge", summary: "Propose a discharge transition record (hospital only)", description: "Admission → inpatient encounter; lines → reconciliation. Hazard H-34: a STOP line can never become a current medicine; current requires an explicit CONTINUE / START / CHANGE.", tags: [T.providerProposals], auth: "provider", request: proposeDischargeSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/provider/patients/:linkId/proposals", summary: "Proposals this organization sent for the patient, with status", tags: [T.providerProposals], auth: "provider", ...hw(S.itemsOf(S.anyObject)) },
  { method: "GET", path: "/v1/provider/proposals/:id", summary: "One proposal and its status", tags: [T.providerProposals], auth: "provider", ...hw(S.anyObject) },

  { method: "GET", path: "/v1/profiles/current/proposals", summary: "Proposals inbox (all kinds, cursor-paged)", tags: [T.proposals], auth: "patient", headers: [PROFILE], scope: "view_profile", query: proposalsQuerySchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/proposals/:id", summary: "One proposal", tags: [T.proposals], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.anyObject) },
  { method: "POST", path: "/v1/proposals/:id/accept", summary: "Accept a proposal — the only path that writes clinical tables", description: "Applies through the existing services with the organization's provenance (`clinic_entered` / `pharmacy_entered` / `lab_imported`). Scope by kind: `edit_medications` (reconciliation, discharge, dispense), `edit_profile` (prescription, encounter), `upload_tests` (diagnostic report). Individual lines can be declined.", tags: [T.proposals], auth: "patient", stepUp: true, headers: [PROFILE, CLIENT], scope: "view_profile", request: acceptProposalSchema, requestOptional: true, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/proposals/:id/reject", summary: "Reject a proposal", tags: [T.proposals], auth: "patient", headers: [PROFILE], scope: "view_profile", request: rejectProposalSchema, requestOptional: true, ...hw(S.anyObject) },

  // ───────────────────────── FHIR (Phase 8 / 15) ─────────────────────────
  {
    method: "GET",
    path: "/v1/profiles/current/fhir/export",
    summary: "Export the patient's own record as a FHIR R4 Bundle (collection)",
    description: "Every canonical row (allergies, conditions, medicines, prescriptions, reports, results, measurements, documents, practitioners, organizations) serialized through `@medpass/fhir` for the chosen NRCeS IG (`?ig=6.5|7.0`, default 6.5), each with its Provenance. Rows without a provenance block are refused by the serializer and recorded as `FhirValidationFailure`; unmapped codes export with a local CodeSystem and are recorded too. Attachments are opaque references, never URLs. Body is `application/fhir+json`.",
    tags: [T.fhir],
    auth: "patient",
    stepUp: true,
    headers: [PROFILE],
    scope: "share_records",
    query: fhirExportQuerySchema,
    ...hw([{ status: 200, schema: S.anyObject, contentType: "application/fhir+json", description: "FHIR R4 `Bundle` of type `collection`." }]),
  },
  {
    method: "GET",
    path: "/v1/profiles/current/fhir/ips",
    summary: "Indian Patient Summary document (IG v7.0 only)",
    description: "Phase 15 (docs_v2/08 §8): a `Bundle` of type `document` opening with the IPS Composition. Sections carry only rows the patient has confirmed; every entry has a Provenance. `?ig` accepts only `7.0`.",
    tags: [T.fhir],
    auth: "patient",
    stepUp: true,
    headers: [PROFILE],
    scope: "share_records",
    query: fhirPatientSummaryQuerySchema,
    ...hw([{ status: 200, schema: S.anyObject, contentType: "application/fhir+json", description: "FHIR R4 `Bundle` of type `document`." }]),
  },

  // ───────────────────────── ABDM (Phase 8) ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/abha", summary: "ABHA link status", description: "`linked: false` until the patient connects an ABHA; then the ABHA address, a masked number and the linked care-context count. The full ABHA number is never returned by a list/status route.", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "view_profile", ...hw(S.anyObject) },
  { method: "POST", path: "/v1/profiles/current/abha/link/init", summary: "Start linking an ABHA", description: "`method` is `abha_number` | `mobile` | `aadhaar_otp`; returns the gateway `transactionId` the OTP must be verified against. Recorded as an `AbdmTransaction`. Patient-only (`manage_consents`).", tags: [T.abdm], auth: "patient", stepUp: true, headers: [PROFILE], scope: "manage_consents", request: abhaLinkInitSchema, ...hw([{ status: 202, schema: S.anyObject, description: "`{ transactionId, otpSentTo, expiresInSeconds }`." }]) },
  { method: "POST", path: "/v1/profiles/current/abha/link/verify", summary: "Complete an ABHA link with the OTP", description: "Creates (or refreshes) the profile's `AbhaLink`: the ABHA number is stored encrypted with a digest index; a different ABHA supersedes the previous link. Imported rows are never touched.", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "manage_consents", request: abhaLinkVerifySchema, ...hw(S.anyObject) },
  { method: "DELETE", path: "/v1/profiles/current/abha", summary: "Unlink the ABHA", description: "Ends the identity link only — rows imported under it keep their `abdm_imported` provenance and `sourceAbdmTxnId` (docs_v2/05 §10).", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "manage_consents" },
  { method: "POST", path: "/v1/profiles/current/abha/discover", summary: "Start care-context discovery at an HIP", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "manage_consents", request: abdmDiscoverSchema, requestOptional: true, ...hw([{ status: 202, schema: S.anyObject, description: "`{ transactionId }`; poll `GET …/discover/:txnId`." }]) },
  { method: "GET", path: "/v1/profiles/current/abha/discover/:txnId", summary: "Discovery result (poll)", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "manage_consents", ...hw(S.anyObject) },
  { method: "POST", path: "/v1/profiles/current/abha/care-contexts/link", summary: "Link discovered care contexts", description: "Links the chosen care contexts at the HIP (HIP OTP in `otp` when required) and records them as `AbdmCareContext` rows.", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "manage_consents", request: abdmCareContextLinkSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/profiles/current/abdm/consents", summary: "ABDM consent artefacts", description: "A separate list from MedicinePassport shares and `Consent` rows (ADR-V2-004).", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "manage_consents", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/profiles/current/abdm/consents/:id/revoke", summary: "Revoke an ABDM consent artefact", tags: [T.abdm], auth: "patient", stepUp: true, headers: [PROFILE], scope: "manage_consents", request: abdmConsentRevokeSchema, requestOptional: true, ...hw(S.entity) },
  { method: "GET", path: "/v1/profiles/current/abdm/bundles", summary: "Received health-information bundles and their import status", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "view_documents", ...hw(S.itemsOf(S.entity)) },
  { method: "POST", path: "/v1/abdm/bundles/:id/import", summary: "Import a received bundle as confirmation-queue candidates", description: "docs_v2/08 §7: the bundle is filed as a `PatientDocument` (source channel `abdm`, provenance `abdm_imported` / `source_authenticated`) with `DocumentCandidate` rows parsed from its resources. Nothing reaches a clinical table until the patient confirms a candidate through the documents-v2 queue. Validation findings are recorded as `FhirValidationFailure` rows (direction `inbound`).", tags: [T.abdm], auth: "patient", headers: [PROFILE], scope: "upload_documents", ...hw(S.anyObject) },
  // ───────────────────────── V2 Phase 17: test-due, measurement reminders, WhatsApp (docs_v2/05 §12) ─────────────────────────
  { method: "GET", path: "/v1/profiles/current/test-due", summary: "Test-due schedules", description: "Each item carries `lastDoneOn`: the date of the latest matching DiagnosticReport (same analyte, or same report kind), the fact the `test_due` reminder cron acts on.", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "view_tests", ...hw(S.itemsOf(S.entity)) },
  { method: "GET", path: "/v1/profiles/current/test-due/:id", summary: "One test-due schedule", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "view_tests", ...hw(S.entity) },
  { method: "POST", path: "/v1/profiles/current/test-due", summary: "Plan a test", description: "Name an analyte or a report kind, and a next due date and/or an interval in days. With only an interval the next date is anchored on the latest matching result (or today). Drives `test_due` reminders (detect-test-due cron), subject to the per-kind channel/frequency control and the daily cap.", tags: [T.notifications], auth: "patient", headers: [PROFILE, IDEMPOTENCY], scope: "upload_tests", request: createTestDueSchema, ...hw(S.entity) },
  { method: "PATCH", path: "/v1/profiles/current/test-due/:id", summary: "Update a test-due schedule", description: "`status: dismissed` silences it; a new `nextDueOn` on a notified/done/dismissed schedule re-arms it.", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "upload_tests", request: updateTestDueSchema, ...hw(S.entity) },
  { method: "DELETE", path: "/v1/profiles/current/test-due/:id", summary: "Delete a test-due schedule (soft)", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "upload_tests" },
  { method: "GET", path: "/v1/profiles/current/measurement-reminders", summary: "Measurement reminder plan", description: "Per ObservationConcept: local times of day and ISO weekdays (Mon = 1). Stored with the notification preferences; the detect-measurement-reminders cron emits one `measurement_reminder` per slot.", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "manage_reminders", ...hw(S.anyObject) },
  { method: "PUT", path: "/v1/profiles/current/measurement-reminders", summary: "Replace the measurement reminder plan", description: "Full replace; `{ concepts: {} }` clears every reminder. The per-kind channel/frequency controls are untouched.", tags: [T.notifications], auth: "patient", headers: [PROFILE], scope: "manage_reminders", request: measurementRemindersSchema, ...hw(S.anyObject) },
  { method: "POST", path: "/v1/notification-channels/whatsapp", summary: "WhatsApp opt-in — not available yet", description: "docs_v2/05 §12: the channel is in the contract but no Business Solution Provider is contracted (OD-10). Always `501 channel_not_available`; the body is not read and nothing is stored.", tags: [T.notifications], auth: "patient", ...hw([{ status: 501, description: "`channel_not_available` problem — WhatsApp waits for a BSP." }]) },

  // ───────────────────────── Admin platform (docs_v2/05 §13, docs_v2/14 §3) ─────────────────────────
  { method: "GET", path: "/v1/admin/flags", summary: "Feature flags: rows plus the static defaults they override", tags: [T.adminPlatform], auth: "admin", duty: "manage_flags", ...hw(S.itemsOf(S.anyObject)) },
  { method: "GET", path: "/v1/admin/flags/:key", summary: "One feature flag", tags: [T.adminPlatform], auth: "admin", duty: "manage_flags", ...hw(S.anyObject) },
  { method: "PUT", path: "/v1/admin/flags/:key", summary: "Create or replace a feature flag (audited with the note)", description: "super_admin only. `allowProfileIds` are opaque; `rolloutPercent` buckets profiles by a stable hash of the profile id.", tags: [T.adminPlatform], auth: "admin", duty: "manage_flags", request: putFeatureFlagSchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/admin/support-cases", summary: "Support case queue", tags: [T.adminSupport], auth: "admin", duty: "manage_support_cases", query: supportCasesQuerySchema, ...hw(S.pageOf(S.entity)) },
  { method: "GET", path: "/v1/admin/support-cases/:id", summary: "Support case detail with notes and break-glass grants", tags: [T.adminSupport], auth: "admin", duty: "manage_support_cases", ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/support-cases", summary: "Open a support case", tags: [T.adminSupport], auth: "admin", duty: "manage_support_cases", request: createSupportCaseSchema, ...hw(S.entity) },
  { method: "PATCH", path: "/v1/admin/support-cases/:id", summary: "Update status, subject or assignee", tags: [T.adminSupport], auth: "admin", duty: "manage_support_cases", request: updateSupportCaseSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/support-cases/:id/notes", summary: "Add a note", tags: [T.adminSupport], auth: "admin", duty: "manage_support_cases", request: supportCaseNoteSchema, ...hw(S.entity) },
  { method: "POST", path: "/v1/admin/break-glass", summary: "Grant time-boxed break-glass access to one record", description: "docs_v2/10 H-49, docs_v2/11 §7: reason required, at most 60 minutes, the admin's current TOTP code re-verified (`403 mfa_invalid` otherwise), written to the audit chain against the profile, and a `system` notification is queued for the patient. Only the grant exists in this release — no admin clinical read endpoint; `BreakGlassService.assertActive` is the single check any future one must pass.", tags: [T.adminPlatform], auth: "admin", duty: "grant_break_glass", request: breakGlassRequestSchema, ...hw(S.entity) },
  { method: "GET", path: "/v1/admin/break-glass", summary: "Break-glass log (reading it is audited)", tags: [T.adminPlatform], auth: "admin", duty: "view_break_glass", query: breakGlassListQuerySchema, ...hw(S.pageOf(S.entity)) },
  { method: "GET", path: "/v1/admin/consent-audit", summary: "Consent + ABDM consent timeline for one opaque profile id", description: "Types, purposes, statuses and instants only — never `Consent.scope`, event context or artefact JSON. Audited against the profile.", tags: [T.adminPlatform], auth: "admin", duty: "search_audit", query: consentAuditQuerySchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/admin/documents/status", summary: "Document processing funnel", description: "uploaded → classified → extracted → confirmed over a trailing window, failures by engine. Counts only.", tags: [T.adminPlatform], auth: "admin", duty: "view_operations", query: documentsStatusQuerySchema, ...hw(S.anyObject) },
  { method: "GET", path: "/v1/admin/abdm/transactions", summary: "ABDM transaction explorer", tags: [T.adminAbdm], auth: "admin", duty: "view_abdm_operations", query: abdmTransactionsQuerySchema, ...hw(S.pageOf(S.entity)) },
  { method: "GET", path: "/v1/admin/fhir/validation-failures", summary: "FHIR validation failures", tags: [T.adminFhir], auth: "admin", duty: "view_fhir", query: fhirValidationFailuresQuerySchema, ...hw(S.pageOf(S.entity)) },
  { method: "GET", path: "/v1/admin/integrations", summary: "Adapter health", description: "One row per external dependency (OCR / classifier / extractor engines with versions, catalog version, push, SMS, email, WhatsApp BSP, ABDM gateway, FHIR validator, interaction provider, lab APIs) with a last-success timestamp derived from BackgroundJob rows where a queue exists.", tags: [T.adminPlatform], auth: "admin", duty: "view_operations", ...hw(S.itemsOf(S.anyObject)) },
  { method: "GET", path: "/v1/admin/notifications/failures", summary: "Notification failures by channel and kind", tags: [T.adminPlatform], auth: "admin", duty: "view_operations", query: notificationFailuresQuerySchema, ...hw(S.anyObject) },
];

/** `/v1/medications/:id` → `/v1/medications/{id}` (the OpenAPI path template form). */
export function toOpenApiPath(nestPath: string): string {
  return nestPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${toOpenApiPath(path)}`;
}

export function registryByKey(): Map<string, RouteDoc> {
  const map = new Map<string, RouteDoc>();
  for (const route of ROUTES) {
    const key = routeKey(route.method, route.path);
    if (map.has(key)) throw new Error(`openapi registry: duplicate entry for ${key}`);
    map.set(key, route);
  }
  return map;
}
