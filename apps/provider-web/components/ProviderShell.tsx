"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button, PillSpinner } from "@medpass/ui-web";
import { useProviderSession } from "../lib/session";
import { ORGANIZATION_KIND_LABELS } from "../lib/proposal-kinds";

/** Authenticated frame: organization name + mode, nav, sign-out; redirects to /login when signed out. */
export function ProviderShell({ children, maxWidth = 960 }: { children: ReactNode; maxWidth?: number }) {
  const { status, organization, isOwner, signOut } = useProviderSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed_out") router.replace("/login");
  }, [status, router]);

  if (status !== "ready" || !organization) {
    return (
      <main style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--color-text-muted)" }}>
        <PillSpinner label="Loading…" />
      </main>
    );
  }

  const navItems: Array<{ href: string; label: string }> = [
    { href: "/", label: "Patients" },
    { href: "/organization", label: isOwner ? "Organization & members" : "Organization" },
  ];

  return (
    <div style={{ minHeight: "100dvh" }}>
      <a
        href="#main"
        style={{ position: "absolute", left: -9999, top: 0, background: "var(--color-surface)", padding: "var(--space-sm)" }}
        onFocus={(e) => (e.currentTarget.style.left = "var(--space-sm)")}
        onBlur={(e) => (e.currentTarget.style.left = "-9999px")}
      >
        Skip to content
      </a>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-sm)",
          padding: "var(--space-sm) var(--space-lg)",
          borderBottom: "1px solid var(--color-border)",
          background: "var(--color-surface)",
        }}
      >
        <nav aria-label="Main" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-sm)", alignItems: "center" }}>
          <Link href="/" style={{ textDecoration: "none", color: "var(--color-text)", marginRight: "var(--space-md)" }}>
            <strong>{organization.displayName}</strong>
            <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)", marginLeft: "var(--space-xs)" }}>
              {ORGANIZATION_KIND_LABELS[organization.kind] ?? organization.kind}
            </span>
          </Link>
          {navItems.map((item) => {
            const active = item.href === "/" ? pathname === "/" || pathname.startsWith("/patients") : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: "var(--size-touch)",
                  padding: "0 var(--space-sm)",
                  color: active ? "var(--color-primary)" : "var(--color-text)",
                  fontWeight: active ? 700 : 400,
                  textDecoration: "none",
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>
      <main id="main" style={{ maxWidth, margin: "0 auto", padding: "var(--space-lg) var(--space-md)" }}>
        {children}
      </main>
    </div>
  );
}
