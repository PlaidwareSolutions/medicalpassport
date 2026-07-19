"use client";
import type { ConsentDto } from "@medpass/api-client";
import { api, getActiveProfileId } from "./api";

export async function listConsents(): Promise<ConsentDto[]> {
  const res = await api.get<{ items: ConsentDto[] }>("/profiles/current/consents", { profileId: getActiveProfileId() });
  return res.items;
}

export async function grantConsent(type: string, purpose: string): Promise<ConsentDto> {
  return api.post<ConsentDto>("/profiles/current/consents", { type, purpose }, { profileId: getActiveProfileId() });
}

export async function revokeConsent(id: string): Promise<void> {
  await api.post(`/consents/${id}/revoke`, undefined, { profileId: getActiveProfileId() });
}
