"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, type CaregiverRelationshipKind, type ClaimInvitationDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export async function createDependent(input: {
  displayName: string;
  yearOfBirth?: number;
  preferredLocale: string;
  relationship: CaregiverRelationshipKind;
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

/** Not profile-scoped — resolved from the caller's own phone digest server-side. */
export function useClaimInvitations() {
  const [items, setItems] = useState<ClaimInvitationDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: ClaimInvitationDto[] }>("/profiles/claim-invitations");
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : "network");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, error, reload: load };
}

/** Not profile-scoped. */
export async function claimProfile(profileId: string) {
  return api.post<{ id: string; displayName: string }>("/profiles/claim", { profileId });
}
