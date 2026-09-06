/**
 * Hand-written JSON Schema fragments for response bodies that have no Zod
 * schema yet (ADR-V2-013). Every entry built from these is stamped
 * `x-response-schema-source: "hand-written"` in the generated document so
 * the provisional status is visible to client generators and reviewers.
 *
 * Keep these deliberately loose (`additionalProperties` left open): they
 * describe the *shape a client may rely on*, not the full DTO — the full
 * DTO becomes authoritative only once a Zod response schema exists in
 * `packages/validation` and the registry entry switches to it.
 */

export type JsonSchema = Record<string, unknown>;

export const ERROR_CODE_VALUES = [
  "validation_failed",
  "unauthenticated",
  "session_revoked",
  "forbidden",
  "step_up_required",
  "caregiver_scope_missing",
  "not_found",
  "conflict_row_version",
  "idempotent_replay_mismatch",
  "otp_invalid",
  "otp_expired",
  "otp_locked",
  "otp_resend_limit",
  "rate_limited",
  "storage_quota_exceeded",
  "turnstile_failed",
  "device_not_trusted",
  "invalid_status_transition",
  "consent_required",
  "admin_credentials_invalid",
  "mfa_invalid",
  "admin_locked",
  "maker_checker_conflict",
  "self_account_minor",
  "guardian_attestation_required",
  "provenance_not_client_settable",
  "internal_error",
] as const;

/** RFC 7807 body emitted by `ProblemDetailsFilter` (docs_v2/05 conventions). */
export const problemSchema: JsonSchema = {
  type: "object",
  description:
    "RFC 7807 problem details (`application/problem+json`). Never carries PHI or stack traces. `code` is the stable machine-readable error; `correlationId` echoes the `x-correlation-id` response header.",
  required: ["type", "title", "status", "code"],
  properties: {
    type: { type: "string", examples: ["about:blank"] },
    title: { type: "string" },
    status: { type: "integer" },
    code: { type: "string", enum: [...ERROR_CODE_VALUES] },
    correlationId: { type: "string" },
    errors: {
      type: "array",
      description: "Field-level issues, present on `validation_failed`.",
      items: {
        type: "object",
        required: ["path", "message"],
        properties: { path: { type: "string" }, message: { type: "string" } },
      },
    },
  },
};

const uuid: JsonSchema = { type: "string", format: "uuid" };
const dateTime: JsonSchema = { type: "string", format: "date-time" };
const nullableDateTime: JsonSchema = { type: ["string", "null"], format: "date-time" };

/** `{ items: T[] }` envelope used by every list endpoint. */
export function itemsOf(item: JsonSchema, description?: string): JsonSchema {
  return {
    type: "object",
    required: ["items"],
    ...(description ? { description } : {}),
    properties: { items: { type: "array", items: item } },
  };
}

/** Cursor-paginated envelope `{ items, nextCursor }`. */
export function pageOf(item: JsonSchema, cursorType: JsonSchema = { type: ["string", "null"] }): JsonSchema {
  return {
    type: "object",
    required: ["items"],
    properties: { items: { type: "array", items: item }, nextCursor: cursorType },
  };
}

/** A resource row: `id` plus whatever else the service returns. */
export const entity: JsonSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuid },
};

/** A resource row that carries optimistic-concurrency `rowVersion`. */
export const versionedEntity: JsonSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuid, rowVersion: { type: "integer" }, createdAt: dateTime, updatedAt: dateTime },
};

/** Any JSON object whose fields are not yet pinned. */
export const anyObject: JsonSchema = { type: "object" };

export const okResponse: JsonSchema = {
  type: "object",
  required: ["ok"],
  properties: { ok: { type: "boolean", const: true } },
};

export const messageResponse: JsonSchema = {
  type: "object",
  required: ["message"],
  properties: { message: { type: "string" } },
};

export const otpRequested: JsonSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string" },
    transport: { type: "string", enum: ["log", "sms", "voice"] },
  },
};

export const otpTransport: JsonSchema = {
  type: "object",
  required: ["transport"],
  properties: { transport: { type: "string", enum: ["log", "sms", "voice"] } },
};

export const sessionProfile: JsonSchema = {
  type: "object",
  required: ["id", "displayName", "relationship", "rowVersion"],
  properties: {
    id: uuid,
    displayName: { type: "string" },
    relationship: { type: "string", enum: ["self", "dependent", "caregiver"] },
    rowVersion: { type: "integer" },
  },
};

/**
 * Body of a successful sign-in / refresh / device login. The session token
 * is set as an httpOnly cookie for browsers and also returned as `token`
 * for native clients (bearer).
 */
export const issuedSession: JsonSchema = {
  type: "object",
  required: ["user", "token", "profiles"],
  properties: {
    user: {
      type: "object",
      required: ["id", "preferredLocale"],
      properties: { id: uuid, preferredLocale: { type: "string" } },
    },
    token: { type: "string", description: "Opaque bearer token (native clients); browsers rely on the cookie." },
    profiles: { type: "array", items: sessionProfile },
  },
};

export const sessionStatus: JsonSchema = {
  type: "object",
  required: ["sessionId", "expiresAt", "stepUpFresh", "stepUpFreshnessSeconds"],
  properties: {
    sessionId: uuid,
    expiresAt: dateTime,
    stepUpVerifiedAt: nullableDateTime,
    stepUpFresh: { type: "boolean" },
    stepUpFreshnessSeconds: { type: "integer" },
  },
};

export const stepUpVerified: JsonSchema = {
  type: "object",
  required: ["stepUpVerifiedAt", "stepUpFresh", "stepUpFreshnessSeconds"],
  properties: {
    stepUpVerifiedAt: dateTime,
    stepUpFresh: { type: "boolean", const: true },
    stepUpFreshnessSeconds: { type: "integer" },
  },
};

export const device: JsonSchema = {
  type: "object",
  required: ["id", "isCurrent"],
  properties: {
    id: uuid,
    kind: { type: "string" },
    label: { type: ["string", "null"] },
    lastSeenAt: nullableDateTime,
    isCurrent: { type: "boolean" },
  },
};

/** Admin login / MFA step / refresh outcome. Session tokens travel as httpOnly cookies only. */
export const adminAuthStatus: JsonSchema = {
  type: "object",
  required: ["status"],
  properties: { status: { type: "string", enum: ["ready", "mfa_required", "mfa_enrollment_required"] } },
};

export const adminSessionRow: JsonSchema = {
  type: "object",
  required: ["id", "createdAt", "expiresAt", "current"],
  properties: { id: uuid, createdAt: dateTime, expiresAt: dateTime, current: { type: "boolean" } },
};

export const mfaEnrollment: JsonSchema = {
  type: "object",
  required: ["secretBase32", "otpauthUri"],
  properties: { secretBase32: { type: "string" }, otpauthUri: { type: "string", format: "uri" } },
};

export const adminMe: JsonSchema = {
  type: "object",
  required: ["adminUserId", "email", "duties"],
  properties: {
    adminUserId: uuid,
    email: { type: "string", format: "email" },
    duties: { type: "array", items: { type: "string" } },
  },
};

export const profile: JsonSchema = {
  type: "object",
  required: ["id", "displayName", "relationship", "rowVersion"],
  properties: {
    id: uuid,
    displayName: { type: "string" },
    relationship: { type: "string", enum: ["self", "dependent", "caregiver"] },
    yearOfBirth: { type: ["integer", "null"] },
    preferredLocale: { type: "string" },
    timezone: { type: "string" },
    claimInvited: { type: "boolean" },
    rowVersion: { type: "integer" },
    hasOpenAlerts: { type: "boolean" },
  },
};

export const healthz: JsonSchema = {
  type: "object",
  required: ["status"],
  properties: { status: { type: "string", enum: ["ok"] } },
};

export const readyz: JsonSchema = {
  type: "object",
  required: ["status"],
  properties: {
    status: { type: "string", enum: ["ready"] },
    checks: { type: "object", additionalProperties: { type: "string" } },
  },
};

export const version: JsonSchema = {
  type: "object",
  required: ["version"],
  properties: { version: { type: "string" } },
};

export const flags: JsonSchema = {
  type: "object",
  description: "Feature flags (`featureFlagsFromEnv`).",
  required: ["prescriptionUpload", "safetyFindings", "sharing", "aiExplanations"],
  properties: {
    prescriptionUpload: { type: "boolean" },
    safetyFindings: { type: "boolean" },
    sharing: { type: "boolean" },
    aiExplanations: { type: "boolean" },
  },
};

export const vapidPublicKey: JsonSchema = {
  type: "object",
  properties: { publicKey: { type: ["string", "null"] } },
};

export const uploadAuthorization: JsonSchema = {
  type: "object",
  required: ["documentId", "uploadUrl", "expiresAt"],
  properties: {
    documentId: uuid,
    uploadUrl: { type: "string", format: "uri", description: "Presigned PUT target (R2, or the dev-storage stand-in)." },
    expiresAt: dateTime,
    approachingStorageQuota: { type: "boolean" },
  },
};

export const documentStatus: JsonSchema = {
  type: "object",
  required: ["id", "status"],
  properties: { id: uuid, status: { type: "string" } },
};

export const documentRow: JsonSchema = {
  type: "object",
  required: ["id", "kind", "status", "createdAt"],
  properties: { id: uuid, kind: { type: "string" }, status: { type: "string" }, createdAt: dateTime },
};

export const downloadUrl: JsonSchema = {
  type: "object",
  required: ["url", "expiresAt"],
  properties: { url: { type: "string", format: "uri" }, expiresAt: dateTime },
};

// ─────────────────── Documents V2 (docs_v2/05 §5, docs_v2/04 §7) ───────────────────

export const documentV2Page: JsonSchema = {
  type: "object",
  required: ["pageNumber", "status"],
  properties: {
    pageNumber: { type: "integer" },
    status: { type: "string", description: "The page object's own status: pending, verified, quarantined, deleted." },
    contentType: { type: ["string", "null"] },
    sizeBytes: { type: ["integer", "null"] },
    sha256: { type: ["string", "null"] },
    downloadUrl: { type: ["string", "null"], format: "uri", description: "Short-lived, minted per request; never stored." },
    downloadUrlExpiresAt: { type: ["string", "null"], format: "date-time" },
  },
};

export const documentV2Classification: JsonSchema = {
  type: "object",
  description:
    "What the classifier read the document as, and who decided the effective `kind`. `classifiedBy: \"user\"` means the patient chose it and no classification run may move it (docs_v2/09 §4).",
  properties: {
    kind: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
    classifiedBy: { type: ["string", "null"], enum: ["user", "deterministic", "model", null] },
  },
};

export const documentV2: JsonSchema = {
  type: "object",
  required: ["id", "kind", "status", "pageCount", "pages", "classification", "createdAt"],
  properties: {
    id: uuid,
    kind: { type: "string" },
    title: { type: ["string", "null"] },
    documentDate: { type: ["string", "null"], format: "date" },
    status: { type: "string" },
    sourceChannel: { type: "string" },
    pageCount: { type: "integer", description: "Pages whose bytes are verified — not pages authorized." },
    prescriptionId: { type: ["string", "null"], format: "uuid" },
    diagnosticReportId: { type: ["string", "null"], format: "uuid" },
    encounterId: { type: ["string", "null"], format: "uuid" },
    immunizationId: { type: ["string", "null"], format: "uuid" },
    classification: documentV2Classification,
    extraction: { type: ["object", "null"] },
    pages: { type: "array", items: documentV2Page },
    createdAt: dateTime,
  },
};

export const documentV2Created: JsonSchema = {
  ...documentV2,
  description: "The new document, plus one presigned upload authorization per requested page, in page order.",
  properties: {
    ...(documentV2.properties as Record<string, JsonSchema>),
    pages: {
      type: "array",
      items: {
        type: "object",
        required: ["pageNumber", "uploadUrl", "expiresAt"],
        properties: { pageNumber: { type: "integer" }, uploadUrl: { type: "string", format: "uri" }, expiresAt: dateTime },
      },
    },
    approachingStorageQuota: { type: "boolean" },
  },
};

export const documentV2Page_upload: JsonSchema = {
  type: "object",
  required: ["documentId", "pages"],
  properties: {
    documentId: uuid,
    pages: {
      type: "array",
      items: {
        type: "object",
        required: ["pageNumber", "uploadUrl", "expiresAt"],
        properties: { pageNumber: { type: "integer" }, uploadUrl: { type: "string", format: "uri" }, expiresAt: dateTime },
      },
    },
    approachingStorageQuota: { type: "boolean" },
  },
};

export const documentV2PageCompleted: JsonSchema = {
  type: "object",
  required: ["id", "status", "pageCount"],
  properties: {
    id: uuid,
    status: { type: "string" },
    pageCount: { type: "integer" },
    pagesAuthorized: { type: "integer" },
  },
};

export const documentV2List: JsonSchema = {
  type: "object",
  required: ["items", "nextCursor"],
  properties: {
    items: { type: "array", items: documentV2 },
    nextCursor: { type: ["string", "null"], description: "Opaque keyset cursor; absent when this is the last page." },
  },
};

export const documentCandidate: JsonSchema = {
  type: "object",
  description:
    "A proposal, never a fact. Carries the exact source line, its page and box, and a confidence — nothing here is clinical data until a person confirms it (docs_v2/09 §1 rule 3).",
  required: ["id", "targetEntity", "targetField", "detectedText", "confidence", "confidenceBucket", "status"],
  properties: {
    id: uuid,
    targetEntity: { type: "string" },
    targetField: { type: "string" },
    groupKey: { type: ["string", "null"], description: "Fields read off the same source line share a group." },
    pageNumber: { type: ["integer", "null"] },
    boundingBox: { type: ["object", "null"], description: "Normalized 0–1 page coordinates, when word boxes were available." },
    detectedText: { type: "string" },
    proposedValue: {},
    confidence: { type: "number" },
    confidenceBucket: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "docs_v2/09 §6: high pre-selects, medium asks the patient to check, low is only ever \"other things we saw\". No auto-confirm at any threshold.",
    },
    status: { type: "string", enum: ["proposed", "confirmed", "corrected", "rejected"] },
    correctedValue: {},
    resultingEntityType: { type: ["string", "null"] },
    resultingEntityId: { type: ["string", "null"], format: "uuid" },
  },
};

export const documentExtraction: JsonSchema = {
  type: "object",
  required: ["documentId", "status", "extraction"],
  properties: {
    documentId: uuid,
    status: { type: "string", description: "The document's own status." },
    extraction: {
      type: ["object", "null"],
      properties: {
        id: uuid,
        status: { type: "string" },
        engine: { type: "string" },
        engineVersion: { type: "string" },
        modelProvider: { type: ["string", "null"] },
        modelName: { type: ["string", "null"] },
        modelVersion: { type: ["string", "null"] },
        promptVersion: { type: ["string", "null"] },
        startedAt: { type: ["string", "null"], format: "date-time" },
        finishedAt: { type: ["string", "null"], format: "date-time" },
        candidateCount: { type: "integer" },
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              targetEntity: { type: "string" },
              groupKey: { type: ["string", "null"] },
              candidates: { type: "array", items: documentCandidate },
            },
          },
        },
      },
    },
  },
};

export const candidateDecision: JsonSchema = {
  type: "object",
  required: ["id", "status"],
  properties: {
    id: uuid,
    status: { type: "string", enum: ["confirmed", "corrected", "rejected"] },
    resultingEntityType: { type: ["string", "null"] },
    resultingEntityId: { type: ["string", "null"], format: "uuid" },
  },
};

export const materializedRows: JsonSchema = {
  type: "object",
  required: ["extractionId", "created"],
  properties: {
    extractionId: uuid,
    created: {
      type: "array",
      items: {
        type: "object",
        required: ["entityType", "entityId"],
        properties: {
          entityType: { type: "string" },
          entityId: uuid,
          candidateIds: { type: "array", items: uuid },
        },
      },
    },
  },
};

export const shareCreated: JsonSchema = {
  type: "object",
  required: ["id", "token", "expiresAt"],
  properties: {
    id: uuid,
    token: { type: "string", description: "Opaque share token; returned once, at creation." },
    expiresAt: dateTime,
  },
};

export const shareRevoked: JsonSchema = {
  type: "object",
  required: ["id", "revokedAt"],
  properties: { id: uuid, revokedAt: dateTime },
};

export const syncResult: JsonSchema = {
  type: "object",
  required: ["applied", "conflicts", "changes", "nextCursor"],
  properties: {
    applied: { type: "array", items: uuid, description: "clientMutationIds applied (or already applied — idempotent)." },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        required: ["clientMutationId", "kind"],
        properties: {
          clientMutationId: uuid,
          kind: { type: "string" },
        },
      },
    },
    changes: {
      type: "array",
      description: "Invalidation signals (docs/15), never row patches.",
      items: anyObject,
    },
    nextCursor: { type: "string", format: "date-time" },
  },
};

export const openapiDocument: JsonSchema = {
  type: "object",
  required: ["openapi", "info", "paths"],
  properties: { openapi: { type: "string" }, info: { type: "object" }, paths: { type: "object" } },
};

export const binaryPdf: JsonSchema = { type: "string", format: "binary" };
export const plainText: JsonSchema = { type: "string" };
