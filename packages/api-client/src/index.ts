import type { CaregiverScope, ProblemDetails } from "@medpass/domain";

/**
 * Typed API client shared by the PWA and (later) native apps. Sessions ride
 * an httpOnly cookie on web; native clients set a bearer token instead.
 */

export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    readonly status: number,
  ) {
    super(problem.title);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Native clients supply a token; the web relies on cookies. */
  getBearerToken?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  constructor(private readonly opts: ApiClientOptions) {}

  async request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    init?: { idempotencyKey?: string; profileId?: string },
  ): Promise<T> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      // CSRF defense: state-changing requests must carry a custom header.
      "x-requested-with": "medpass",
    };
    const token = this.opts.getBearerToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    if (init?.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
    if (init?.profileId) headers["x-profile-id"] = init.profileId;

    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(`${this.opts.baseUrl}${path}`, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const problem = (json ?? {
        type: "about:blank",
        title: "Request failed",
        status: res.status,
        code: "internal_error",
      }) as ProblemDetails;
      throw new ApiError(problem, res.status);
    }
    return json as T;
  }

  get<T>(path: string, init?: { profileId?: string }) {
    return this.request<T>("GET", path, undefined, init);
  }

  /** For binary responses (e.g. PDF export) — same auth, no JSON parsing. */
  async getBlob(path: string, init?: { profileId?: string }): Promise<Blob> {
    const headers: Record<string, string> = {};
    const token = this.opts.getBearerToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    if (init?.profileId) headers["x-profile-id"] = init.profileId;

    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(`${this.opts.baseUrl}${path}`, { method: "GET", headers, credentials: "include" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as ProblemDetails | null;
      const problem = json ?? { type: "about:blank", title: "Request failed", status: res.status, code: "internal_error" };
      throw new ApiError(problem, res.status);
    }
    return res.blob();
  }
  post<T>(path: string, body?: unknown, init?: { idempotencyKey?: string; profileId?: string }) {
    return this.request<T>("POST", path, body, init);
  }
  patch<T>(path: string, body?: unknown, init?: { idempotencyKey?: string; profileId?: string }) {
    return this.request<T>("PATCH", path, body, init);
  }
  delete<T>(path: string, init?: { profileId?: string }) {
    return this.request<T>("DELETE", path, undefined, init);
  }
}

// ---- response shapes (kept in sync with OpenAPI; codegen replaces these later) ----

export interface SessionResponse {
  user: { id: string; preferredLocale: string };
  profiles: ProfileSummary[];
}

export interface ProfileSummary {
  id: string;
  displayName: string;
  yearOfBirth: number | null;
  relationship: "self" | "dependent" | "caregiver";
  /** True when this (unclaimed) dependent profile has a pending claim invite. */
  claimInvited?: boolean;
  rowVersion: number;
  /** True when this profile has a currently-missed dose — omitted from the login response, only present via GET /profiles. */
  hasOpenAlerts?: boolean;
}

export interface ClaimInvitationDto {
  profileId: string;
  displayName: string;
  yearOfBirth: number | null;
}

export type CaregiverRelationshipKind = "parent" | "child" | "spouse" | "sibling" | "other";

export interface CaregiverRelationshipDto {
  id: string;
  relationship: CaregiverRelationshipKind;
  /** Patient-entered, distinguishes this caregiver from another with the same relationship. */
  label: string | null;
  /** The API only ever returns "invited" | "active" today (revoked/expired
   * rows are filtered out server-side) — typed against the full enum for
   * accuracy, not against what's currently reachable. */
  status: "invited" | "active" | "revoked" | "expired";
  scopes: CaregiverScope[];
  acceptedAt: string | null;
  expiresAt: string | null;
}

export interface CaregiverInvitationDto {
  id: string;
  patientDisplayName: string;
  relationship: CaregiverRelationshipKind;
  scopes: CaregiverScope[];
  expiresAt: string | null;
}

export interface CaregiverAccessEventDto {
  accessedAt: string;
}

export interface CatalogProduct {
  id: string;
  brandName: string | null;
  genericName: string;
  strengthLabel: string | null;
  form: string | null;
  isCombination: boolean;
  ingredients: Array<{ name: string; strength: string | null }>;
}

export interface MedicationInstructionDto {
  doseQuantity: string;
  doseUnit: string;
  frequencyCode: string;
  pattern: string | null;
  foodInstruction: string;
  durationDays: number | null;
}

/**
 * Clinical-reviewer-approved content for one docs/07 screen 19 block —
 * only ever present once a human reviewer has approved it; always carries
 * source/review provenance alongside the text, never a bare claim.
 */
export interface ClinicalContentEntryDto {
  text: string;
  sourceCitation: string;
  sourceUrl: string | null;
  lastReviewedAt: string | null;
  /** Set only when an approved translation for the patient's own locale is shown instead of the English body. */
  locale?: string;
}

/** Each key present only when a reviewer has approved that kind for this medicine's (single) ingredient. */
export interface ClinicalContentDto {
  education?: ClinicalContentEntryDto;
  storage?: ClinicalContentEntryDto;
  warningSymptoms?: ClinicalContentEntryDto;
  foodAlcohol?: ClinicalContentEntryDto;
  missedDose?: ClinicalContentEntryDto;
}

export interface PatientMedicationDto {
  id: string;
  enteredName: string;
  product: CatalogProduct | null;
  clinicalContent: ClinicalContentDto;
  patientReason: string | null;
  prescriberName: string | null;
  status: string;
  isPrn: boolean;
  startDate: string | null;
  endDate: string | null;
  quantityOnHand: string | null;
  criticalEscalation: boolean;
  rowVersion: number;
  instruction: MedicationInstructionDto | null;
  createdAt: string;
}

export interface RefillReminderDto {
  notificationId: string;
  kind: "refill" | "completion";
  patientMedicationId: string;
  medicationName: string;
  prescriberName: string | null;
  quantityOnHand: string | null;
  rowVersion: number;
  daysRemainingEstimate: number | null;
  estimatedDate: string | null;
}

/**
 * Persistent in-app record of a missed-dose caregiver escalation — the
 * push/SMS notification is a one-shot alert; this is the durable list a
 * caregiver (or the patient) can check regardless of whether that delivery
 * succeeded. "missed" means still open; "taken_other_time" means the
 * patient corrected it (shown for a trailing window, not forever).
 */
export interface CaregiverAlertDto {
  scheduledDoseId: string;
  medicationName: string;
  dueAt: string;
  quantity: string;
  status: "missed" | "taken_other_time";
  updatedAt: string;
}

export interface TimelineItemDto {
  scheduledDoseId: string;
  dueAt: string;
  slotLabel: string;
  quantity: string;
  status: string;
  snoozedUntil: string | null;
  isDueNow: boolean;
  medication: {
    id: string;
    name: string;
    doseUnit: string;
    foodInstruction: string;
    /** Approved missed-dose guidance (docs/07 screen 26) — present only when status is "missed". */
    missedDoseGuidance?: ClinicalContentEntryDto | null;
  };
}

export interface TimelineDto {
  date: string;
  items: TimelineItemDto[];
}

export interface AllergyDto {
  id: string;
  label: string;
  severity: string;
  reactionNote: string | null;
  source: string;
  active: boolean;
  createdAt: string;
}

export interface SafetyFindingDto {
  id: string;
  category: string;
  severity: string;
  medicationIds: string[];
  ruleKey: string;
  ruleVersion: string;
  sourceName: string;
  explanationKey: string;
  detail: Record<string, unknown> | null;
  status: string;
  evaluatedAt: string;
}

export interface VisitSummaryDto {
  profile: { displayName: string; yearOfBirth: number | null; sex: string | null };
  generatedAt: string;
  allergies?: Array<{ label: string; severity: string; reactionNote: string | null }>;
  conditions?: Array<{ label: string; note: string | null }>;
  currentMedications?: Array<{
    id: string;
    name: string;
    ingredients: string[];
    strengthLabel: string | null;
    instructionSummary: string;
    prescriberName: string | null;
    startDate: string | null;
  }>;
  recentChanges?: Array<{ medicationName: string; change: string; occurredAt: string }>;
  unresolvedConcerns?: Array<{ category: string; severity: string; summary: string }>;
}

export interface ShareDto {
  id: string;
  kind: string;
  sections: Record<string, boolean>;
  expiresAt: string;
  revokedAt: string | null;
  accessCount: number;
  createdAt: string;
}

export interface ShareAccessEventDto {
  result: string;
  accessedAt: string;
}

export interface AuthorizeUploadResponseDto {
  documentId: string;
  uploadUrl: string;
  expiresAt: string;
  /** Soft warn (docs/31 cost controls) — still succeeded, but nearing the per-profile document storage quota. */
  approachingStorageQuota: boolean;
}

export interface DocumentDto {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
}

export interface ExtractionCandidateDto {
  id: string;
  field: "brand_name" | "frequency" | "food_instruction";
  detectedText: string;
  proposedValue: string | null;
  /** Human-readable version of proposedValue (e.g. a resolved product name). */
  proposedLabel: string | null;
  confidence: number;
  status: "proposed" | "confirmed" | "rejected";
  confirmedValue: string | null;
}

export interface DocumentExtractionDto {
  documentId: string;
  status: string;
  extraction: {
    id: string;
    status: string;
    candidates: ExtractionCandidateDto[];
  } | null;
}

export interface VapidPublicKeyDto {
  publicKey: string | null;
}

export interface OtpTransportDto {
  transport: "log" | "sms" | "voice";
}

export interface NotificationPreferencesDto {
  pushEnabled: boolean;
  privacyMode: "generic" | "full_name";
}

export interface ConsentDto {
  id: string;
  type: string;
  purpose: string;
  status: "active" | "revoked" | "expired";
  grantedAt: string;
  revokedAt: string | null;
}
