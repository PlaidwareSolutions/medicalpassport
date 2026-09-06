"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { api, getOrganizationId, setOrganizationId } from "./api";
import type { OrganizationDto, ProviderSessionDto } from "./types";

interface ProviderSessionState {
  status: "loading" | "signed_out" | "ready";
  session?: ProviderSessionDto;
  /** The organization this session acts for, with its authoritative allowed proposal kinds. */
  organization?: OrganizationDto;
  isOwner: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const ProviderSessionContext = createContext<ProviderSessionState | null>(null);

/**
 * Provider session (docs_v2/05 §11): the httpOnly cookie is the credential;
 * this only mirrors what `GET provider/auth/session` says. A member of
 * several organizations acts for the one chosen at sign-in
 * (`x-organization-id`); if that choice is missing or stale the guard
 * answers 400/403 and the user is sent back to sign in and choose again.
 */
export function ProviderSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ProviderSessionState["status"]>("loading");
  const [session, setSession] = useState<ProviderSessionDto | undefined>(undefined);
  const [organization, setOrganization] = useState<OrganizationDto | undefined>(undefined);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<ProviderSessionDto>("/provider/auth/session");
      const org = await api.get<OrganizationDto>("/provider/organizations/current");
      setSession(me);
      setOrganization(org);
      setStatus("ready");
    } catch (err) {
      if (err instanceof ApiError) {
        // 401 (no/expired session), 403 (not a member any more) and 400
        // (organization choice required) all mean: sign in again.
        if (err.status === 400 || err.status === 403) setOrganizationId(undefined);
        setSession(undefined);
        setOrganization(undefined);
        setStatus("signed_out");
      } else {
        // Genuine network failure — don't bounce to /login on a transient blip.
        setStatus((s) => (s === "loading" ? "signed_out" : s));
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.post("/provider/auth/logout");
    } catch {
      // The cookie is cleared server-side on success; on failure the session
      // simply expires. Either way the UI signs out.
    } finally {
      setOrganizationId(undefined);
      setSession(undefined);
      setOrganization(undefined);
      setStatus("signed_out");
      router.replace("/login");
    }
  }, [router]);

  const value = useMemo<ProviderSessionState>(
    () => ({
      status,
      session,
      organization,
      isOwner: (organization?.role ?? session?.current.role) === "owner",
      refresh,
      signOut,
    }),
    [status, session, organization, refresh, signOut],
  );

  return <ProviderSessionContext.Provider value={value}>{children}</ProviderSessionContext.Provider>;
}

export function useProviderSession(): ProviderSessionState {
  const ctx = useContext(ProviderSessionContext);
  if (!ctx) throw new Error("useProviderSession outside ProviderSessionProvider");
  return ctx;
}

/** The stored organization choice, for screens that need it before the session resolves. */
export function currentOrganizationId(): string | undefined {
  return getOrganizationId();
}
