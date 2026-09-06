/**
 * How trusted a clinical value is. Ordered: the tuple index is the rank, and
 * `verification` may only ever move to a higher rank (ADR-V2-002).
 */
export const VERIFICATION_STATES = [
  "unverified",
  "patient_confirmed",
  "provider_verified",
  "source_authenticated",
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

export function isVerificationState(value: unknown): value is VerificationState {
  return typeof value === "string" && (VERIFICATION_STATES as readonly string[]).includes(value);
}

/** 0-based rank in the monotonic ladder. */
export function verificationRank(state: VerificationState): number {
  return VERIFICATION_STATES.indexOf(state);
}

/** True when `a` is strictly more trusted than `b`. */
export function isHigherVerification(a: VerificationState, b: VerificationState): boolean {
  return verificationRank(a) > verificationRank(b);
}
