"use client";
import { Chip } from "@medpass/ui-web";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";

/**
 * Global, always-visible profile switcher for caregiver accounts (docs/06:
 * "pinned above content; the active profile context is always visible") —
 * a safety control against docs/10 H-13 (wrong-patient data shown), not just
 * navigation convenience, so it renders above the sync-status banners.
 * Renders nothing for single-profile accounts, matching the condition the
 * old inline switcher on /profile used.
 */
export function ProfileSwitcher() {
  const { t } = useI18n();
  const { profiles, activeProfileId, selectProfile } = useSession();

  if (profiles.length <= 1) return null;

  return (
    <nav
      aria-label={t("profile.switcher_label")}
      style={{
        display: "flex",
        gap: "var(--space-sm)",
        overflowX: "auto",
        padding: "var(--space-sm) var(--space-md) 0",
      }}
    >
      {profiles.map((p) => {
        const active = p.id === activeProfileId;
        return (
          <button
            key={p.id}
            type="button"
            aria-current={active ? "true" : undefined}
            aria-label={p.hasOpenAlerts ? t("profile.switcher_alert_label", { name: p.displayName }) : undefined}
            onClick={() => selectProfile(p.id)}
            style={{ border: "none", background: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
          >
            {/* A color-only tone difference isn't a reliable distinction
                (WCAG 1.4.1 — never color alone); the checkmark plus bold
                weight makes the active profile unambiguous regardless of
                color perception, and the same reasoning applies to the
                missed-dose alert indicator (⚠, not just a danger tone). */}
            <Chip tone={p.hasOpenAlerts ? "danger" : active ? "success" : "default"}>
              <span style={{ fontWeight: active ? 700 : 600 }}>
                {active ? "✓ " : ""}
                {p.hasOpenAlerts ? "⚠ " : ""}
                {p.displayName}
              </span>
            </Chip>
          </button>
        );
      })}
    </nav>
  );
}
