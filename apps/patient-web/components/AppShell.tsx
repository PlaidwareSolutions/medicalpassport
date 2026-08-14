"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Banner, BottomNav, Button } from "@medpass/ui-web";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { useCaregiverInvitations } from "../lib/caregivers";
import { useI18n } from "../lib/i18n";
import { useSyncEngine } from "../lib/offline";
import { deviceTimeZone, patientTimeNow } from "../lib/patient-time";
import { useClaimInvitations } from "../lib/profiles";
import { usePushChimeListener } from "../lib/push-chime-listener";
import { useServiceWorkerUpdate } from "../lib/sw-update";
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
  const { status, activeProfileId, profiles } = useSession();
  const sync = useSyncEngine(activeProfileId);
  const swUpdate = useServiceWorkerUpdate();

  // Caregiver-abroad clarity (docs/16): every clinical time on screen is in
  // the PATIENT's zone, so when the viewer's device sits in a different one
  // (a son in Houston, a mother in Hyderabad), say so — with the patient's
  // wall clock right now — before "8:00 AM" gets misread as the viewer's
  // morning. Refreshes each minute so the shown time never drifts stale.
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const profileZone = activeProfile?.timezone;
  const zoneDiffers = !!profileZone && deviceTimeZone() !== profileZone;
  const [patientClock, setPatientClock] = useState("");
  useEffect(() => {
    if (!zoneDiffers || !profileZone) return;
    const update = () => setPatientClock(patientTimeNow(profileZone));
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [zoneDiffers, profileZone]);
  const invitations = useCaregiverInvitations();
  const pendingInvitations = invitations.items?.length ?? 0;
  const claimInvitations = useClaimInvitations();
  const pendingClaimInvitations = claimInvitations.items?.length ?? 0;
  usePushChimeListener();

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

  const showBanner =
    sync.status !== "online" || sync.pendingCount > 0 || sync.storageTrimmed || sync.conflictCount > 0 || swUpdate.updateAvailable;

  return (
    // Flex column with the (sticky) BottomNav as the last in-flow child: the
    // bar keeps its own layout space and may grow taller than one row at
    // large text sizes (docs/33 reflow), so no manual bottom padding is
    // needed to stop it covering content.
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <ProfileSwitcher />
      {zoneDiffers && activeProfile && patientClock ? (
        <div style={{ padding: "var(--space-sm) var(--space-md) 0" }}>
          <Banner tone="info">
            {t("tz.viewing_patient_time", { name: activeProfile.displayName, time: patientClock })}
          </Banner>
        </div>
      ) : null}
      {pendingInvitations > 0 ? (
        <div style={{ padding: "var(--space-sm) var(--space-md) 0" }}>
          <Banner tone="info">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)" }}>
              <span>{t("caregiver.pending_invitations_banner", { count: pendingInvitations })}</span>
              <Link href="/caregivers/invitations" style={{ color: "inherit", textDecoration: "underline" }}>
                {t("caregiver.pending_invitations_link")}
              </Link>
            </div>
          </Banner>
        </div>
      ) : null}
      {pendingClaimInvitations > 0 ? (
        <div style={{ padding: "var(--space-sm) var(--space-md) 0" }}>
          <Banner tone="info">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)" }}>
              <span>{t("caregiver.pending_claim_invitations_banner", { count: pendingClaimInvitations })}</span>
              <Link href="/profile/claim-invitations" style={{ color: "inherit", textDecoration: "underline" }}>
                {t("caregiver.pending_invitations_link")}
              </Link>
            </div>
          </Banner>
        </div>
      ) : null}
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
          {swUpdate.updateAvailable ? (
            <Banner tone="info">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-sm)" }}>
                <span>{t("app.update_available")}</span>
                <Button variant="secondary" onClick={swUpdate.reload}>
                  {t("app.update_reload")}
                </Button>
              </div>
            </Banner>
          ) : null}
        </div>
      ) : null}
      {/* The actual profile-switch remount boundary is ProfileKeyedContent,
          above the page component in app/layout.tsx — a key here would only
          reset what this component receives as `children`, never the page
          component's own data hooks (useMedications, useTimeline, ...),
          which are called before the page ever renders AppShell at all. */}
      <main style={{ flex: 1, width: "100%", maxWidth: 560, margin: "0 auto", padding: "var(--space-md) var(--space-md) var(--space-lg)" }}>{children}</main>
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
