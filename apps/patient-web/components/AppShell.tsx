"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Banner, BottomNav } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { useSyncEngine } from "../lib/offline";
import { useSession } from "../lib/session";

const BANNER_TONE = {
  online: "info",
  offline: "warning",
  syncing: "info",
  sync_failed: "danger",
  changes_pending: "warning",
} as const;

/**
 * Authenticated app frame: honest sync-status banner (docs/15 — online,
 * offline, syncing, failed, pending, last-synced are all distinguished, not
 * collapsed into a single online/offline flag), content region, bottom
 * navigation (docs/06).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();
  const sync = useSyncEngine();

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

  const showBanner = sync.status !== "online" || sync.pendingCount > 0 || sync.storageTrimmed || sync.conflictCount > 0;

  return (
    <div style={{ minHeight: "100dvh", paddingBottom: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + var(--space-md))" }}>
      {showBanner ? (
        <div style={{ padding: "var(--space-sm) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <Banner tone={BANNER_TONE[sync.status]}>
            {sync.status === "offline"
              ? t("common.offline_banner")
              : sync.status === "syncing"
                ? t("sync.syncing")
                : sync.status === "sync_failed"
                  ? t("sync.failed")
                  : t("sync.pending", { count: sync.pendingCount })}
          </Banner>
          {/* Pending count is a fact independent of connectivity — show it
              even while the primary line above is "offline" (docs/15). */}
          {sync.pendingCount > 0 && sync.status !== "changes_pending" ? (
            <Banner tone="warning">{t("sync.pending", { count: sync.pendingCount })}</Banner>
          ) : null}
          {sync.status === "sync_failed" ? (
            <button
              type="button"
              onClick={() => void sync.flush()}
              style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--color-info)", textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: "var(--font-small)" }}
            >
              {t("common.retry")}
            </button>
          ) : null}
          {sync.storageTrimmed ? <Banner tone="info">{t("sync.storage_trimmed")}</Banner> : null}
          {sync.conflictCount > 0 ? (
            <Banner tone="warning">
              {t("sync.conflicts_pending", { count: sync.conflictCount })}{" "}
              <Link href="/sync/conflicts" style={{ color: "inherit", textDecoration: "underline" }}>
                {t("sync.conflicts_review")}
              </Link>
            </Banner>
          ) : null}
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
