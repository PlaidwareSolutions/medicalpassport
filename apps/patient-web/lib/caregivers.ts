"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type CaregiverAccessEventDto,
  type CaregiverInvitationDto,
  type CaregiverRelationshipDto,
  type CaregiverRelationshipKind,
} from "@medpass/api-client";
import type { CaregiverScope } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";

/**
 * The list endpoint only ever returns "invited"/"active" rows — nothing ever
 * flips a relationship to "expired" server-side, expiry is only enforced at
 * authorization-check time. A relationship whose expiresAt has passed would
 * otherwise look permanently "active" to the patient (docs/10 H-13-adjacent
 * trust concern) — compute the honest state client-side, the same pattern
 * share/page.tsx already uses for share links.
 */
export function isCaregiverActive(item: Pick<CaregiverRelationshipDto, "status" | "expiresAt">): boolean {
  if (item.status !== "active") return false;
  return !item.expiresAt || new Date(item.expiresAt) > new Date();
}

export function useCaregivers() {
  const [items, setItems] = useState<CaregiverRelationshipDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: CaregiverRelationshipDto[] }>("/profiles/current/caregivers", {
        profileId: getActiveProfileId(),
      });
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

/** Not profile-scoped — resolved from the caller's own phone digest server-side. */
export function useCaregiverInvitations() {
  const [items, setItems] = useState<CaregiverInvitationDto[] | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const res = await api.get<{ items: CaregiverInvitationDto[] }>("/caregivers/invitations");
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

export async function fetchCaregiverAccessLog(relationshipId: string): Promise<CaregiverAccessEventDto[]> {
  const res = await api.get<{ items: CaregiverAccessEventDto[] }>(`/caregivers/${relationshipId}/accesses`, {
    profileId: getActiveProfileId(),
  });
  return res.items;
}

export async function inviteCaregiver(input: {
  phone: string;
  scopes: CaregiverScope[];
  relationship: CaregiverRelationshipKind;
  label?: string;
  expiresAt?: string;
}) {
  return api.post<{ id: string; status: string }>("/profiles/current/caregivers", input, {
    profileId: getActiveProfileId(),
  });
}

/** Not profile-scoped — matched against the caller's own phone digest. */
export async function acceptInvitation(invitationId: string) {
  return api.post<{ id: string; status: string; patientProfileId: string }>("/caregivers/accept", { invitationId });
}

export async function updateCaregiverScopes(relationshipId: string, scopes: CaregiverScope[], label?: string) {
  return api.patch<{ id: string; scopes: CaregiverScope[] }>(
    `/caregivers/${relationshipId}/scopes`,
    { scopes, ...(label !== undefined ? { label } : {}) },
    { profileId: getActiveProfileId() },
  );
}

export async function revokeCaregiver(relationshipId: string) {
  return api.delete(`/caregivers/${relationshipId}`, { profileId: getActiveProfileId() });
}
