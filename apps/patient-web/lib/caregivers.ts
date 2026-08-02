"use client";
import type {
  CaregiverAccessEventDto,
  CaregiverInvitationDto,
  CaregiverRelationshipDto,
  CaregiverRelationshipKind,
} from "@medpass/api-client";
import type { CaregiverScope } from "@medpass/domain";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

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
  const { data, error, reload } = useSharedResource<CaregiverRelationshipDto[]>({
    path: "/profiles/current/caregivers",
    fetcher: async () =>
      (await api.get<{ items: CaregiverRelationshipDto[] }>("/profiles/current/caregivers", { profileId: getActiveProfileId() }))
        .items,
  });
  return { items: data, error, reload };
}

/**
 * Not profile-scoped — resolved from the caller's own phone digest
 * server-side, hence `scope: "user"` (a profile switch must not bust it).
 * AppShell mounts this on every page; the short TTL is what stops that
 * costing a request per navigation. Worst case: the invitation banner
 * appears up to a minute late. The invitations page itself calls `reload()`,
 * which forces past the TTL.
 */
export function useCaregiverInvitations() {
  const { data, error, reload } = useSharedResource<CaregiverInvitationDto[]>({
    path: "/caregivers/invitations",
    scope: "user",
    ttlMs: 60_000,
    fetcher: async () => (await api.get<{ items: CaregiverInvitationDto[] }>("/caregivers/invitations")).items,
  });
  return { items: data, error, reload };
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
  const res = await api.post<{ id: string; status: string }>("/profiles/current/caregivers", input, {
    profileId: getActiveProfileId(),
  });
  invalidate("profile", "/profiles/current/caregivers");
  return res;
}

/** Not profile-scoped — matched against the caller's own phone digest. */
export async function acceptInvitation(invitationId: string) {
  const res = await api.post<{ id: string; status: string; patientProfileId: string }>("/caregivers/accept", { invitationId });
  // The AppShell banner count must be right on the very next navigation, not
  // a TTL later.
  invalidate("user", "/caregivers/invitations");
  return res;
}

export async function updateCaregiverScopes(relationshipId: string, scopes: CaregiverScope[], label?: string) {
  const res = await api.patch<{ id: string; scopes: CaregiverScope[] }>(
    `/caregivers/${relationshipId}/scopes`,
    { scopes, ...(label !== undefined ? { label } : {}) },
    { profileId: getActiveProfileId() },
  );
  invalidate("profile", "/profiles/current/caregivers");
  return res;
}

export async function revokeCaregiver(relationshipId: string) {
  const res = await api.delete(`/caregivers/${relationshipId}`, { profileId: getActiveProfileId() });
  invalidate("profile", "/profiles/current/caregivers");
  return res;
}
