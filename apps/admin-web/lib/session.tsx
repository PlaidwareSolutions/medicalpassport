"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "@medpass/api-client";
import { api } from "./api";

interface AdminMe {
  adminUserId: string;
  email: string;
  duties: string[];
}

interface AdminSessionState {
  status: "loading" | "signed_out" | "ready";
  admin?: AdminMe;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AdminSessionContext = createContext<AdminSessionState | null>(null);

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AdminSessionState["status"]>("loading");
  const [admin, setAdmin] = useState<AdminMe | undefined>(undefined);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<AdminMe>("/admin/auth/me");
      setAdmin(me);
      setStatus("ready");
    } catch (err) {
      if (err instanceof ApiError) {
        setAdmin(undefined);
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
      await api.post("/admin/auth/logout");
    } finally {
      setAdmin(undefined);
      setStatus("signed_out");
      router.replace("/login");
    }
  }, [router]);

  const value = useMemo(() => ({ status, admin, refresh, signOut }), [status, admin, refresh, signOut]);

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionState {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) throw new Error("useAdminSession outside AdminSessionProvider");
  return ctx;
}
