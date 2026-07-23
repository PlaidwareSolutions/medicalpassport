import type { CaregiverScope } from "@medpass/domain";

/**
 * Pure authorization policy. The API resolves the caller's relationship to a
 * profile and asks this module for the decision — keeping policy testable and
 * shared with future services. Enforcement is always server-side (docs/02).
 */

export interface ProfileAccessContext {
  /** The authenticated user. */
  userId: string;
  /** Owner of the target profile. */
  profileOwnerUserId: string;
  /** User who claimed the profile (a dependent who took it over), if any. */
  profileClaimedByUserId?: string | null;
  /** Active caregiver scopes the user holds on this profile, if any. */
  caregiverScopes?: readonly CaregiverScope[];
}

export type ProfileAction =
  | "view_profile"
  | "edit_profile"
  | "view_medications"
  | "add_medications"
  | "edit_medications"
  | "record_doses"
  | "view_schedule"
  | "manage_reminders"
  | "review_concerns"
  | "share_records"
  | "manage_caregivers"
  | "manage_consents"
  | "manage_claim";

const SCOPE_GRANTS: Record<ProfileAction, CaregiverScope[]> = {
  view_profile: ["view_medications", "view_schedule", "manage_profile", "full_management"],
  edit_profile: ["manage_profile", "full_management"],
  view_medications: ["view_medications", "full_management"],
  add_medications: ["add_medications", "full_management"],
  edit_medications: ["edit_medications", "full_management"],
  record_doses: ["record_doses", "full_management"],
  view_schedule: ["view_schedule", "full_management"],
  manage_reminders: ["manage_reminders", "full_management"],
  review_concerns: ["review_concerns", "full_management"],
  share_records: ["share_records", "full_management"],
  // Only the patient themself may manage caregivers, consents, and
  // invite/cancel a claim on the profile — no scope ever grants these.
  manage_caregivers: [],
  manage_consents: [],
  manage_claim: [],
};

export interface AccessDecision {
  allowed: boolean;
  /** Whether the caller acts as the patient (owner/claimer) or a caregiver. */
  actorRole: "patient" | "caregiver" | "none";
}

export function decideProfileAccess(ctx: ProfileAccessContext, action: ProfileAction): AccessDecision {
  const isSelf = ctx.userId === (ctx.profileClaimedByUserId ?? ctx.profileOwnerUserId);
  if (isSelf) return { allowed: true, actorRole: "patient" };

  const scopes = ctx.caregiverScopes ?? [];
  if (scopes.length > 0) {
    const allowed = SCOPE_GRANTS[action].some((s) => scopes.includes(s));
    return { allowed, actorRole: allowed ? "caregiver" : "none" };
  }
  return { allowed: false, actorRole: "none" };
}
