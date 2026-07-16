import type { ProblemDetails } from "@medpass/domain";

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
  post<T>(path: string, body?: unknown, init?: { idempotencyKey?: string; profileId?: string }) {
    return this.request<T>("POST", path, body, init);
  }
  patch<T>(path: string, body?: unknown, init?: { profileId?: string }) {
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
  relationship: "self" | "dependent" | "caregiver";
  rowVersion: number;
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

export interface PatientMedicationDto {
  id: string;
  enteredName: string;
  product: CatalogProduct | null;
  patientReason: string | null;
  prescriberName: string | null;
  status: string;
  isPrn: boolean;
  startDate: string | null;
  endDate: string | null;
  rowVersion: number;
  instruction: MedicationInstructionDto | null;
  createdAt: string;
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
