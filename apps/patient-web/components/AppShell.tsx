"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Banner, BottomNav } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";

/**
 * Authenticated app frame: online/offline status banner (docs/15 honest
 * status), content region, bottom navigation (docs/06).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (status === "signed_out") router.replace("/welcome");
    if (status === "needs_profile") router.replace("/onboarding/profile");
  }, [status, router]);

  if (status === "loading") {
    return (
      <main style={{ padding: "var(--space-xl)", textAlign: "center", color: "var(--color-text-muted)" }}>
        {t("common.loading")}
      </main>
    );
  }

  const items = [
    { key: "home", label: t("nav.home"), icon: "⌂", href: "/", active: pathname === "/" },
    { key: "meds", label: t("nav.medicines"), icon: "💊", href: "/medicines", active: pathname.startsWith("/medicines") },
    { key: "add", label: t("nav.add"), icon: "＋", href: "/add", active: pathname.startsWith("/add") },
    { key: "safety", label: t("nav.safety"), icon: "🛡", href: "/safety", active: pathname.startsWith("/safety") },
    { key: "profile", label: t("nav.profile"), icon: "👤", href: "/profile", active: pathname.startsWith("/profile") },
  ];

  return (
    <div style={{ minHeight: "100dvh", paddingBottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + var(--space-md))" }}>
      {!online ? (
        <div style={{ padding: "var(--space-sm) var(--space-md)" }}>
          <Banner tone="warning">{t("common.offline_banner")}</Banner>
        </div>
      ) : null}
      <main style={{ maxWidth: 560, margin: "0 auto", padding: "var(--space-md)" }}>{children}</main>
      <BottomNav
        items={items}
        renderLink={(item, children) => (
          <Link key={item.key} href={item.href} aria-current={item.active ? "page" : undefined}>
            {children}
          </Link>
        )}
      />
    </div>
  );
}
