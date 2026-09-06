"use client";
import { ApiClient } from "@medpass/api-client";
import { apiBaseUrl } from "./api-origin";

/**
 * A staff member of several organizations must say which one a request
 * acts for (`x-organization-id`, ProviderGuard). The choice is made once at
 * sign-in and kept here — an opaque id, never a name.
 */
const ORGANIZATION_STORAGE_KEY = "medpass_provider_organization";

export function getOrganizationId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(ORGANIZATION_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setOrganizationId(id: string | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ORGANIZATION_STORAGE_KEY, id);
    else window.localStorage.removeItem(ORGANIZATION_STORAGE_KEY);
  } catch {
    // Storage unavailable (private mode): the header is simply not sent and a
    // multi-organization member is asked to sign in again.
  }
}

/**
 * Sessions ride the httpOnly `medpass_provider_session` cookie; the shared
 * client already adds the CSRF header the guard demands on writes. The
 * organization header is layered in through `fetchImpl` because the client
 * has no per-request header hook.
 */
export const api = new ApiClient({
  baseUrl: `${apiBaseUrl()}/v1`,
  fetchImpl: (input, init) => {
    const headers = new Headers(init?.headers);
    const organizationId = getOrganizationId();
    if (organizationId) headers.set("x-organization-id", organizationId);
    return fetch(input, { ...init, headers });
  },
});

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
