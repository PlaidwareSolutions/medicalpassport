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

/**
 * Every action the API may ask `decideProfileAccess` about. Kept as a value
 * (not only a type) so test/matrix.test.ts can enumerate it, cross-check it
 * against the literals actually used in apps/api, and snapshot the full
 * relationship × scope × action matrix (docs_v2/03 §6).
 */
export const PROFILE_ACTIONS = [
  "view_profile",
  "edit_profile",
  "view_medications",
  "add_medications",
  "edit_medications",
  "record_doses",
  "view_schedule",
  "manage_reminders",
  "review_concerns",
  "share_records",
  "manage_caregivers",
  "manage_consents",
  "manage_claim",
  // V2 Phase 6 (docs_v2/04 §2.2, roadmap §15 permission model). Tests,
  // measurements and documents used to sit under view_profile/edit_profile,
  // which meant a caregiver trusted with the patient's name and blood group
  // was also trusted with every lab result. These split that apart.
  "view_tests",
  "upload_tests",
  "view_measurements",
  "add_measurements",
  "view_documents",
  "upload_documents",
] as const;

export type ProfileAction = (typeof PROFILE_ACTIONS)[number];

/**
 * The single explicit map from action → caregiver scopes that grant it. A
 * caregiver holding any listed scope is allowed; an empty list means no
 * scope ever grants the action (patient-only). The self/claimer rule lives
 * in `decideProfileAccess`, not here — it bypasses this map entirely.
 */
export const PROFILE_SCOPE_GRANTS: Readonly<Record<ProfileAction, readonly CaregiverScope[]>> = {
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
  // Consents and claiming stay patient-only: no scope ever grants them.
  manage_consents: [],
  manage_claim: [],
  // V2 Phase 6 (docs_v2/04 §2.2, roadmap §15 "manage other caregivers").
  // Grantable now, but ONLY by its own named scope — deliberately not by
  // `full_management`, which is the one documented exception to the
  // "full_management is a superset" rule.
  //
  // The reason is migration, not tidiness. Caregivers already hold
  // full_management in production. Adding this to it would silently widen
  // who can bring more people into a patient's record, without the patient
  // ever being asked. A power that changes who else can read the record has
  // to be granted deliberately, by name.
  manage_caregivers: ["manage_caregivers"],

  // V2 Phase 6. Tests, measurements and documents used to live under
  // view_profile/edit_profile, so every scope that granted those must keep
  // granting these — otherwise existing caregivers silently lose access to
  // reports the moment this ships, which is a regression dressed up as a
  // security improvement. The narrow scopes are additive: what is new is
  // being able to grant lab results WITHOUT handing over the whole profile.
  view_tests: ["view_tests", "view_medications", "view_schedule", "manage_profile", "full_management"],
  view_measurements: ["view_measurements", "view_medications", "view_schedule", "manage_profile", "full_management"],
  view_documents: ["view_documents", "view_medications", "view_schedule", "manage_profile", "full_management"],
  upload_tests: ["upload_tests", "manage_profile", "full_management"],
  add_measurements: ["add_measurements", "manage_profile", "full_management"],
  upload_documents: ["upload_documents", "manage_profile", "full_management"],
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
    const allowed = PROFILE_SCOPE_GRANTS[action].some((s) => scopes.includes(s));
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
  // Provider/facility directory stewardship (docs_v2/14 §3): global
  // Organization/Practitioner entries, HFR/HPR verification, merges.
  // Patient-scoped rows are visible as opaque ids + counts only.
  | "provider_admin"
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
  | "view_users"
  | "manage_providers";

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
  manage_providers: ["provider_admin"],
};

export function decideAdminAccess(duties: readonly AdminDuty[], action: AdminAction): boolean {
  if (duties.includes("super_admin")) return true;
  const required = ADMIN_DUTY_GRANTS[action];
  return required.length === 0 || required.some((d) => duties.includes(d));
}
