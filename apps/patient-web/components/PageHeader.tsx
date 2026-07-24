"use client";
import type { CSSProperties, ReactNode } from "react";
import { useSession } from "../lib/session";

/**
 * Standard in-app page title row. Shows the active profile's name,
 * right-aligned next to the title, whenever the account manages more than
 * one profile — a caregiver switching between patients (docs/10 H-13)
 * should never have to scroll back up to the profile switcher just to
 * confirm which patient the screen in front of them belongs to. Hidden
 * entirely for single-profile accounts, matching ProfileSwitcher's own
 * threshold, since it would be redundant there.
 */
export function PageHeader({
  title,
  right,
  style,
}: {
  title: ReactNode;
  /** Extra trailing content some screens already show next to their title (e.g. a status Chip) — rendered below the active-profile name, not instead of it. */
  right?: ReactNode;
  style?: CSSProperties;
}) {
  const { profiles, activeProfileId } = useSession();
  const activeName = profiles.length > 1 ? profiles.find((p) => p.id === activeProfileId)?.displayName : undefined;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "var(--space-sm)",
        margin: "0 0 var(--space-sm)",
        ...style,
      }}
    >
      <h1 style={{ fontSize: "var(--font-title)", margin: 0 }}>{title}</h1>
      {activeName || right ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-xs)", flexShrink: 0 }}>
          {activeName ? (
            <span
              style={{
                fontSize: "var(--font-small)",
                color: "var(--color-text-muted)",
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
            >
              {activeName}
            </span>
          ) : null}
          {right}
        </div>
      ) : null}
    </div>
  );
}
