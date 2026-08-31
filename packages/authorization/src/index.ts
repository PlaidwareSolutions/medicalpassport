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

/**
 * Admin-portal authorization (docs/13/14 "admin duty") — a parallel,
 * separate decision from decideProfileAccess rather than an extension of
 * ProfileAction: most admin operations (catalog CRUD, job replay, audit
 * search) aren't scoped to one PatientProfile at all, so they don't fit the
 * ProfileAccessContext shape.
 */
export type AdminDuty =
  | "catalog_write"
  | "catalog_approve"
  // Distinct from catalog_write/catalog_approve: docs/34 ties clinical
  // content sign-off specifically to a qualified clinical lead (OD-6), a
  // narrower authority than general catalog stewardship. OD-6 itself is
  // enforced procedurally, not here — nobody should hold content_approve
  // until a clinical lead is actually appointed and granted it.
  | "content_write"
  | "content_approve"
  // Proposing a translation of already-approved content — distinct from
  // content_write (translating existing approved text is a different
  // authority than authoring new clinical facts). Deciding a translation
  // reuses content_approve, not a separate duty.
  | "content_translate"
  | "audit_search"
  | "incident_response"
  | "operations_view"
  | "rules_view"
  // Row-level user identity + engagement (pilot operations) — never clinical
  // content. Owner-directed exception to the aggregate-only posture.
  | "users_view"
  | "super_admin";

export type AdminAction =
  | "read_catalog"
  | "propose_catalog_change"
  | "decide_catalog_change"
  | "read_content"
  | "propose_content_change"
  | "decide_content_change"
  | "propose_content_translation"
  | "decide_content_translation"
  | "search_audit"
  | "replay_job"
  | "revoke_share"
  | "view_operations"
  | "view_rules"
  | "view_users";

const ADMIN_DUTY_GRANTS: Record<AdminAction, AdminDuty[]> = {
  read_catalog: [], // any authenticated admin — non-PHI reference data
  propose_catalog_change: ["catalog_write"],
  decide_catalog_change: ["catalog_approve"],
  read_content: [], // any authenticated admin — non-PHI reference data
  propose_content_change: ["content_write"],
  decide_content_change: ["content_approve"],
  propose_content_translation: ["content_translate"],
  decide_content_translation: ["content_approve"],
  search_audit: ["audit_search"],
  replay_job: ["incident_response"],
  revoke_share: ["incident_response"],
  view_operations: ["operations_view"],
  view_rules: ["rules_view"],
  view_users: ["users_view"],
};

export function decideAdminAccess(duties: readonly AdminDuty[], action: AdminAction): boolean {
  if (duties.includes("super_admin")) return true;
  const required = ADMIN_DUTY_GRANTS[action];
  return required.length === 0 || required.some((d) => duties.includes(d));
}
