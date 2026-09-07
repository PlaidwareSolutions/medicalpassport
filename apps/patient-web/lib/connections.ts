"use client";
import type { MessageKey } from "@medpass/localization";
import { api, getActiveProfileId } from "./api";
import { invalidate, useSharedResource } from "./data-cache";

/**
 * Provider links (docs_v2/05 §11, docs_v2/06 P11-3): the clinics,
 * pharmacies, laboratories and hospitals that hold a time-boxed,
 * section-scoped view of this patient's record, and the QR onboarding token
 * that creates one. Both minting and revoking are step-up guarded
 * (ADR-V2-012).
 */

/** The share vocabulary a provider link can grant (docs_v2/04 §11). */
export const PROVIDER_LINK_SECTIONS = [
  "medications",
  "allergies",
  "conditions",
  "recentChanges",
  "concerns",
  "glucoseReadings",
  "bloodPressureReadings",
  "weightReadings",
  "checkups",
  "prescriptions",
  "reports",
  "measurements",
  "documents",
  "encounters",
] as const;
export type ProviderLinkSection = (typeof PROVIDER_LINK_SECTIONS)[number];

export const ONBOARDING_EXPIRIES = ["15m", "1h", "24h"] as const;
export type OnboardingExpiry = (typeof ONBOARDING_EXPIRIES)[number];

export type ProviderLinkStatus = "active" | "revoked" | "expired";

export interface ProviderLinkDto {
  id: string;
  organization?: { id: string; displayName: string; kind: string };
  linkedVia: string;
  sections: ProviderLinkSection[];
  status: ProviderLinkStatus;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface OnboardingTokenDto {
  id: string;
  /** The secret the clinic scans — never rendered anywhere but the code screen. */
  token: string;
  sections: ProviderLinkSection[];
  expiresAt: string;
  accessDays: number;
}

const LINKS_PATH = "/profiles/current/provider-links";

/**
 * The links list needs `share_records`; a caregiver without it sees an
 * empty screen with its teaching copy rather than an error (the screen has
 * nothing to show them either way).
 */
export function useProviderLinks() {
  const { data, error, fromCache, reload } = useSharedResource<ProviderLinkDto[]>({
    path: LINKS_PATH,
    fetcher: async () => (await api.get<{ items: ProviderLinkDto[] }>(LINKS_PATH, { profileId: getActiveProfileId() })).items,
    mapApiError: (err) => (err.status === 403 ? [] : undefined),
  });
  return { items: data, error, fromCache, reload };
}

export async function revokeProviderLink(id: string): Promise<ProviderLinkDto> {
  const res = await api.post<ProviderLinkDto>(`/provider-links/${id}/revoke`, undefined, { profileId: getActiveProfileId() });
  invalidate("profile", LINKS_PATH);
  return res;
}

export async function createOnboardingToken(input: {
  sections: ProviderLinkSection[];
  expiresIn: OnboardingExpiry;
  accessDays: number;
}): Promise<OnboardingTokenDto> {
  const res = await api.post<OnboardingTokenDto>("/profiles/current/onboarding-tokens", input, { profileId: getActiveProfileId() });
  invalidate("profile", LINKS_PATH);
  return res;
}

/** A link is only really open while it is active AND still inside its expiry. */
export function isOpenLink(link: ProviderLinkDto): boolean {
  return link.status === "active" && new Date(link.expiresAt).getTime() > Date.now();
}

export function organizationKindLabelKey(kind: string | undefined): MessageKey {
  switch (kind) {
    case "clinic":
    case "hospital":
    case "pharmacy":
    case "laboratory":
    case "diagnostic_centre":
      return `connections.org_kind.${kind}` as MessageKey;
    default:
      return "connections.org_kind.other";
  }
}

export function sectionLabelKey(section: ProviderLinkSection): MessageKey {
  return `connections.section.${section}` as MessageKey;
}

/**
 * The onboarding token, broken into short groups so a person can actually
 * read it out or type it in.
 *
 * The token is 43 characters of base64url and stays exactly as minted —
 * nothing here changes a single character, and the groups are display only.
 * As one unbroken run it was unreadable across a desk: no place to pause,
 * no way to keep your place, no way to say where you are. Four-character
 * groups are what card numbers, licence keys and OTPs all settled on for
 * the same reason.
 */
export function groupTokenForReading(token: string, size = 4): string[] {
  if (!token) return [];
  const groups: string[] = [];
  for (let i = 0; i < token.length; i += size) groups.push(token.slice(i, i + size));
  return groups;
}
