/**
 * Stable machine-readable error codes shared by API and clients.
 * RFC 7807 problem responses carry one of these in `code`.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: "validation_failed",
  UNAUTHENTICATED: "unauthenticated",
  SESSION_REVOKED: "session_revoked",
  FORBIDDEN: "forbidden",
  /** ADR-V2-012: the session must re-verify (OTP/TOTP) before this action. */
  STEP_UP_REQUIRED: "step_up_required",
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
  DEVICE_NOT_TRUSTED: "device_not_trusted",
  INVALID_STATUS_TRANSITION: "invalid_status_transition",
  CONSENT_REQUIRED: "consent_required",
  ADMIN_CREDENTIALS_INVALID: "admin_credentials_invalid",
  MFA_INVALID: "mfa_invalid",
  ADMIN_LOCKED: "admin_locked",
  MAKER_CHECKER_CONFLICT: "maker_checker_conflict",
  /** A person under 18 may not run their own adult account (children V1). */
  SELF_ACCOUNT_MINOR: "self_account_minor",
  /** A child dependent requires an explicit parent/lawful-guardian attestation. */
  GUARDIAN_ATTESTATION_REQUIRED: "guardian_attestation_required",
  /** ADR-V2-002: clients never set provenance (source, verification, recordedVia, …); services stamp it. */
  PROVENANCE_NOT_CLIENT_SETTABLE: "provenance_not_client_settable",
  /**
   * docs_v2/04 §5.2 and §6.3, hazard H-25: `interpretation` (normal / high /
   * low / critical) is a clinical judgement. It is accepted only on a
   * provider path (`lab_imported`, `clinic_entered`), where it carries the
   * lab's own printed flag. A patient or caregiver sending it is refused,
   * and the server never derives one from a threshold.
   */
  INTERPRETATION_NOT_CLIENT_SETTABLE: "interpretation_not_client_settable",
  /**
   * The value is outside its observation concept's plausibility range
   * (docs_v2/04 §5.2) — "could a human plausibly have produced this number",
   * never a clinical threshold. SpO2 of 140 is a typo; SpO2 of 80 is a real
   * reading this app stores without comment.
   */
  OBSERVATION_OUT_OF_RANGE: "observation_out_of_range",
  /** docs_v2/05 §12: the channel is defined but no provider is contracted yet (WhatsApp until OD-10). HTTP 501. */
  CHANNEL_NOT_AVAILABLE: "channel_not_available",
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
