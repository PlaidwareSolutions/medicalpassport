"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type ProfileSummary } from "@medpass/api-client";
import { api, clearLocalState, getActiveProfileId, setActiveProfileId } from "./api";

interface SessionState {
  status: "loading" | "signed_out" | "needs_profile" | "ready";
  profiles: ProfileSummary[];
  activeProfileId?: string;
  refresh: () => Promise<void>;
  selectProfile: (id: string) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeProfileId, setActive] = useState<string | undefined>(undefined);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ items: ProfileSummary[] }>("/profiles");
      setProfiles(res.items);
      if (res.items.length === 0) {
        setStatus("needs_profile");
        return;
      }
      const stored = getActiveProfileId();
      const active = res.items.find((p) => p.id === stored)?.id ?? res.items[0]!.id;
      setActiveProfileId(active);
      setActive(active);
      setStatus("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Session revoked/expired: purge profile-scoped local state (docs/15).
        await clearLocalState();
        setStatus("signed_out");
      } else {
        // Genuine network failure (no response at all), not a rejection —
        // this fires on every fresh mount, including reopening the app
        // offline. A stored profile id means there was a real prior
        // session: treat it as still "ready" and let each screen serve its
        // own cached data, rather than bouncing to /welcome as if signed
        // out. Only a truly fresh, never-signed-in load falls back.
        const stored = getActiveProfileId();
        if (stored) {
          setActive(stored);
          setStatus("ready");
        } else {
          setStatus((s) => (s === "loading" ? "signed_out" : s));
        }
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectProfile = useCallback((id: string) => {
    setActiveProfileId(id);
    setActive(id);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      await clearLocalState();
      setStatus("signed_out");
      router.replace("/welcome");
    }
  }, [router]);

  const value = useMemo(
    () => ({ status, profiles, activeProfileId, refresh, selectProfile, signOut }),
    [status, profiles, activeProfileId, refresh, selectProfile, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
