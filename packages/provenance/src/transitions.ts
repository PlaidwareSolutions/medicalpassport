import type { ActorKind } from "./actor.js";
import { type VerificationState, verificationRank } from "./verification-state.js";

export type TransitionResult = { ok: true } | { ok: false; reason: string };

/**
 * The highest verification state each actor kind is entitled to set.
 * `null` means the actor may never raise verification at all:
 *   - `system` stamps rows but does not vouch for them;
 *   - `admin` break-glass access is read-only.
 */
export const MAX_VERIFICATION_BY_ACTOR: Readonly<Record<ActorKind, VerificationState | null>> = {
  patient: "patient_confirmed",
  caregiver: "patient_confirmed",
  provider_verified_practitioner: "provider_verified",
  provider_organization: "provider_verified",
  lab_system: "source_authenticated",
  abdm_gateway: "source_authenticated",
  system: null,
  admin: null,
};

/**
 * Monotonic verification state machine (docs_v2/04 §1.2, ADR-V2-002).
 *
 * - Same state: no-op, allowed.
 * - Downward moves are never allowed, for anyone.
 * - Upward moves are allowed only when the target state is at or below the
 *   actor's entitlement ceiling. An actor entitled to a higher rung may also
 *   set lower rungs (e.g. a practitioner may mark `patient_confirmed`).
 */
export function canTransitionVerification(
  from: VerificationState,
  to: VerificationState,
  actor: ActorKind,
): TransitionResult {
  if (from === to) return { ok: true };

  const fromRank = verificationRank(from);
  const toRank = verificationRank(to);
  if (toRank < fromRank) {
    return { ok: false, reason: `verification is monotonic: cannot move down from '${from}' to '${to}'` };
  }

  const ceiling = MAX_VERIFICATION_BY_ACTOR[actor];
  if (ceiling === null) {
    return { ok: false, reason: `actor '${actor}' may never raise verification` };
  }
  if (toRank > verificationRank(ceiling)) {
    return {
      ok: false,
      reason: `actor '${actor}' may raise verification at most to '${ceiling}', not '${to}'`,
    };
  }
  return { ok: true };
}

/** Throwing variant for service code paths. */
export function assertVerificationTransition(
  from: VerificationState,
  to: VerificationState,
  actor: ActorKind,
): void {
  const result = canTransitionVerification(from, to, actor);
  if (!result.ok) throw new VerificationTransitionError(from, to, actor, result.reason);
}

export class VerificationTransitionError extends Error {
  override readonly name = "VerificationTransitionError";
  readonly code = "invalid_status_transition" as const;
  constructor(
    readonly from: VerificationState,
    readonly to: VerificationState,
    readonly actor: ActorKind,
    reason: string,
  ) {
    super(reason);
  }
}
