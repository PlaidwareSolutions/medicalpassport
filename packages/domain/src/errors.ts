/**
 * Stable machine-readable error codes shared by API and clients.
 * RFC 7807 problem responses carry one of these in `code`.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: "validation_failed",
  UNAUTHENTICATED: "unauthenticated",
  SESSION_REVOKED: "session_revoked",
  FORBIDDEN: "forbidden",
  CAREGIVER_SCOPE_MISSING: "caregiver_scope_missing",
  NOT_FOUND: "not_found",
  CONFLICT_ROW_VERSION: "conflict_row_version",
  IDEMPOTENT_REPLAY_MISMATCH: "idempotent_replay_mismatch",
  OTP_INVALID: "otp_invalid",
  OTP_EXPIRED: "otp_expired",
  OTP_LOCKED: "otp_locked",
  OTP_RESEND_LIMIT: "otp_resend_limit",
  RATE_LIMITED: "rate_limited",
  STORAGE_QUOTA_EXCEEDED: "storage_quota_exceeded",
  TURNSTILE_FAILED: "turnstile_failed",
  INVALID_STATUS_TRANSITION: "invalid_status_transition",
  CONSENT_REQUIRED: "consent_required",
  ADMIN_CREDENTIALS_INVALID: "admin_credentials_invalid",
  MFA_INVALID: "mfa_invalid",
  ADMIN_LOCKED: "admin_locked",
  MAKER_CHECKER_CONFLICT: "maker_checker_conflict",
  INTERNAL: "internal_error",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** RFC 7807-style problem body. Never contains PHI or stack traces. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  correlationId?: string;
  errors?: Array<{ path: string; message: string }>;
}
