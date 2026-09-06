"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button, PillSpinner } from "@medpass/ui-web";
import { useAdminSession } from "../lib/session";

/** `duty`: shown only when the session carries that duty (super_admin implies all). */
const NAV_ITEMS: Array<{ href: string; label: string; duty?: string }> = [
  { href: "/", label: "Dashboard" },
  { href: "/catalog", label: "Catalog" },
  { href: "/content", label: "Content" },
  { href: "/audit", label: "Audit" },
  { href: "/incidents", label: "Incidents" },
  { href: "/operations", label: "Operations" },
  { href: "/users", label: "Users" },
  { href: "/rules", label: "Rules" },
  { href: "/organizations", label: "Organizations", duty: "provider_admin" },
  { href: "/practitioners", label: "Practitioners", duty: "provider_admin" },
];

/** Authenticated admin frame: top nav + sign-out, redirects to /login when signed out. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { status, admin, signOut } = useAdminSession();
  const pathname = usePathname();
  const router = useRouter();
  const duties = admin?.duties ?? [];
  const navItems = NAV_ITEMS.filter((item) => !item.duty || duties.includes(item.duty) || duties.includes("super_admin"));

  useEffect(() => {
    if (status === "signed_out") router.replace("/login");
  }, [status, router]);

  if (status !== "ready") {
    return (
      <main style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--color-text-muted)" }}>
        <PillSpinner label="Loading…" />
      </main>
    );
  }

  return (
    <div style={{ minHeight: "100dvh" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-sm) var(--space-lg)",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <nav style={{ display: "flex", gap: "var(--space-md)", alignItems: "center" }}>
          <strong style={{ marginRight: "var(--space-md)" }}>medpass admin</strong>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                color: pathname === item.href ? "var(--color-primary)" : "var(--color-text)",
                fontWeight: pathname === item.href ? 700 : 400,
                textDecoration: "none",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
          <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{admin?.email}</span>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "var(--space-lg)" }}>{children}</main>
    </div>
  );
}
