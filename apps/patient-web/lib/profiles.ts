"use client";
import type { CaregiverRelationshipKind, ClaimInvitationDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

export async function createDependent(input: {
  displayName: string;
  yearOfBirth?: number;
  preferredLocale: string;
  relationship: CaregiverRelationshipKind;
  /** Children V1: required by the server for a child dependent (parent/lawful-guardian attestation). */
  guardianAttestation?: boolean;
}) {
  return api.post<{ id: string; displayName: string; rowVersion: number }>("/profiles/dependents", input);
}

export async function updateProfile(rowVersion: number, patch: { displayName?: string; yearOfBirth?: number }) {
  return api.patch<{ id: string; rowVersion: number }>(
    "/profiles/current",
    { rowVersion, ...patch },
    { profileId: getActiveProfileId() },
  );
}

/** Owner-only — invites the profile's actual subject to claim it (docs/07 screen 5). */
export async function inviteToClaimProfile(phone: string, expiresAt?: string) {
  return api.post<{ id: string; status: string }>(
    "/profiles/current/claim-invite",
    { phone, ...(expiresAt ? { expiresAt } : {}) },
    { profileId: getActiveProfileId() },
  );
}

export async function cancelClaimInvite() {
  return api.delete("/profiles/current/claim-invite", { profileId: getActiveProfileId() });
}

/**
 * Not profile-scoped — resolved from the caller's own phone digest
 * server-side, hence `scope: "user"`. Mounted by AppShell on every page; the
 * TTL is what keeps that from costing a request per navigation.
 */
export function useClaimInvitations() {
  const { data, error, reload } = useSharedResource<ClaimInvitationDto[]>({
    path: "/profiles/claim-invitations",
    scope: "user",
    ttlMs: 60_000,
    fetcher: async () => (await api.get<{ items: ClaimInvitationDto[] }>("/profiles/claim-invitations")).items,
  });
  return { items: data, error, reload };
}

/** Not profile-scoped. */
export async function claimProfile(profileId: string) {
  const res = await api.post<{ id: string; displayName: string }>("/profiles/claim", { profileId });
  invalidate("user", "/profiles/claim-invitations");
  return res;
}
