"use client";
import type { CaregiverScope } from "@medpass/domain";
import { api } from "./api";
import { useSharedResource } from "./data-cache";

/**
 * The family dashboard read (docs_v2/05 §8, docs_v2/06 P6-3):
 * `GET profiles/current/family` — every profile the signed-in user can act
 * on, each with the caller's own relationship, the scopes they hold on it,
 * and a small summary.
 *
 * Two things about the shape matter to every screen that reads it:
 *
 * 1. It is NOT scoped by `x-profile-id` — it is the one read that spans
 *    profiles — so it is cached under `scope: "user"`. A profile switch must
 *    not bust it, and it must never be re-keyed per profile.
 * 2. A summary field the caller's scopes do not grant comes back `null`,
 *    not absent. `null` therefore means "not yours to see", and `0` means
 *    "nothing due" — the UI must render those two differently (a blank
 *    would quietly claim the second when the truth is the first).
 */

export interface FamilyLastMeasurement {
  concept: string;
  label: string;
  value: string;
  value2: string | null;
  unit: string;
  measuredAt: string;
}

export interface FamilyProfileSummary {
  /** Doses still upcoming today in the patient's own zone; null without `view_schedule`. */
  dueDosesToday: number | null;
  /** Missed doses inside the caregiver-alert window; null without `manage_reminders`. */
  openAlerts: number | null;
  /** Newest reading of any concept; null without `view_measurements`, and also null when none exists. */
  lastMeasurement: FamilyLastMeasurement | null;
  /** Placeholder until TestDueSchedule ships (docs_v2/04 §12) — always null today, so never rendered. */
  nextTestDue: null;
}

export interface FamilyProfileDto {
  id: string;
  displayName: string;
  relationship: "self" | "dependent" | "caregiver";
  /** Active caregiver scopes on this profile; empty when the caller is the patient. */
  scopes: CaregiverScope[];
  summary: FamilyProfileSummary;
}

/**
 * A short TTL, not zero: the dashboard is also the source the scope helper
 * reads on every screen (lib/scopes.ts), so a per-navigation refetch would
 * cost a request per page for information that changes when a patient edits
 * an invitation — minutes, not seconds. `/family` itself calls `reload()`.
 */
const FAMILY_TTL_MS = 60_000;

export function useFamily() {
  const { data, error, fromCache, reload } = useSharedResource<FamilyProfileDto[]>({
    path: "/profiles/current/family",
    scope: "user",
    ttlMs: FAMILY_TTL_MS,
    fetcher: async () => (await api.get<{ items: FamilyProfileDto[] }>("/profiles/current/family")).items,
  });
  return { items: data, error, fromCache, reload };
}
