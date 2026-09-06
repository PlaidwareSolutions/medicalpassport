"use client";
import type { CaregiverScope } from "@medpass/domain";
import type { MessageKey } from "@medpass/localization";
import { useFamily } from "./family";
import { useSession } from "./session";

/**
 * Scope-aware UI (docs_v2/06 P6-2): "buttons hidden/disabled per scope;
 * server unchanged".
 *
 * This is a courtesy layer, never the authorization boundary — the API
 * decides, and it is the only thing that decides (docs_v2/03 §6). What this
 * buys is honesty: a caregiver invited only to see medicines should be told
 * that adding a reading is not theirs to do, in words, instead of tapping a
 * button that answers 403.
 *
 * The grant table below mirrors `PROFILE_SCOPE_GRANTS` in
 * `packages/authorization` line for line. It is duplicated rather than
 * imported because that package is a server dependency and patient-web does
 * not take it; the e2e spec asserts the two agree where it matters (a
 * narrow-scope caregiver sees exactly the limited dashboard).
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
  "view_tests",
  "upload_tests",
  "view_measurements",
  "add_measurements",
  "view_documents",
  "upload_documents",
] as const;
export type ProfileAction = (typeof PROFILE_ACTIONS)[number];

/**
 * Action → the caregiver scopes that grant it. An empty list means no scope
 * ever grants it (patient-only). Two entries are deliberately not what a
 * reader might guess, and both are load-bearing:
 *
 * - `manage_caregivers` is granted ONLY by its own name, never by
 *   `full_management`. A power that changes who else can read the record is
 *   granted deliberately or not at all.
 * - the V2 view scopes also accept the older broad scopes, because tests,
 *   measurements and documents used to live under view_profile — dropping
 *   that would take access away from caregivers who already have it.
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
  manage_consents: [],
  manage_claim: [],
  manage_caregivers: ["manage_caregivers"],
  view_tests: ["view_tests", "view_medications", "view_schedule", "manage_profile", "full_management"],
  view_measurements: ["view_measurements", "view_medications", "view_schedule", "manage_profile", "full_management"],
  view_documents: ["view_documents", "view_medications", "view_schedule", "manage_profile", "full_management"],
  upload_tests: ["upload_tests", "manage_profile", "full_management"],
  add_measurements: ["add_measurements", "manage_profile", "full_management"],
  upload_documents: ["upload_documents", "manage_profile", "full_management"],
};

export function scopesGrant(scopes: readonly CaregiverScope[], action: ProfileAction): boolean {
  return PROFILE_SCOPE_GRANTS[action].some((s) => scopes.includes(s));
}

/** The plain-words name of the thing the action lets someone do ("add a reading"). */
export function actionLabelKey(action: ProfileAction): MessageKey {
  return `scope.action.${action}` as MessageKey;
}

/** The plain-words name of one grantable scope, as the invite screen lists it. */
export function scopeLabelKey(scope: CaregiverScope): MessageKey {
  return `caregiver.scope.${scope}` as MessageKey;
}

export interface ProfileAccess {
  /**
   * False until the family read has answered. Screens must treat "not yet
   * known" as allowed — hiding a patient's own buttons for a moment on every
   * navigation would be a worse lie than briefly showing one the server will
   * refuse.
   */
  ready: boolean;
  relationship: "self" | "dependent" | "caregiver" | undefined;
  /** The caller's scopes on the active profile; empty when they are the patient. */
  scopes: CaregiverScope[];
  /** True when the caller acts as a caregiver on the active profile. */
  isCaregiver: boolean;
  can: (action: ProfileAction) => boolean;
}

/**
 * The caller's access to the *active* profile. Reads the family dashboard,
 * which already carries the relationship and scopes per profile, so no
 * screen needs a request of its own.
 */
export function useProfileAccess(): ProfileAccess {
  const { activeProfileId } = useSession();
  const { items } = useFamily();
  const entry = items?.find((p) => p.id === activeProfileId);
  const ready = items !== undefined && entry !== undefined;
  const scopes = entry?.scopes ?? [];
  const isCaregiver = entry?.relationship === "caregiver";

  return {
    ready,
    relationship: entry?.relationship,
    scopes,
    isCaregiver,
    can: (action) => (!ready || !isCaregiver ? true : scopesGrant(scopes, action)),
  };
}
