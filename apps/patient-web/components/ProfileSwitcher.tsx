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
      {profiles.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-current={p.id === activeProfileId ? "true" : undefined}
          onClick={() => selectProfile(p.id)}
          style={{ border: "none", background: "none", padding: 0, cursor: "pointer", flexShrink: 0 }}
        >
          <Chip tone={p.id === activeProfileId ? "success" : "default"}>{p.displayName}</Chip>
        </button>
      ))}
    </nav>
  );
}
