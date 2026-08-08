"use client";
import type { CSSProperties, ReactNode } from "react";
import { useSession } from "../lib/session";
import type { SpeechSegment } from "../lib/read-aloud";
import { ReadAloud } from "./ReadAloud";

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
  readAloud,
  style,
}: {
  title: ReactNode;
  /** Extra trailing content some screens already show next to their title (e.g. a status Chip) — rendered below the active-profile name, not instead of it. */
  right?: ReactNode;
  /**
   * What the header's listen button speaks (docs/07 screen 20): the screen's
   * purpose first (a pre-generated `screen.*` guidance segment), then any
   * dynamic summary. Omitted = no button.
   */
  readAloud?: SpeechSegment[];
  style?: CSSProperties;
}) {
  const { profiles, activeProfileId } = useSession();
  const activeName = profiles.length > 1 ? profiles.find((p) => p.id === activeProfileId)?.displayName : undefined;

  return (
    <div style={{ margin: "0 0 var(--space-sm)", ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "var(--space-sm)",
          // Wrap rather than overflow when the title and profile name can't
          // share a 320px row at 200% zoom (docs/33 reflow).
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: "var(--font-title)", margin: 0, minWidth: 0 }}>{title}</h1>
        {activeName || right ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--space-xs)", minWidth: 0 }}>
            {activeName ? (
              <span
                style={{
                  fontSize: "var(--font-small)",
                  color: "var(--color-text-muted)",
                  textAlign: "end",
                }}
              >
                {activeName}
              </span>
            ) : null}
            {right}
          </div>
        ) : null}
      </div>
      {readAloud ? (
        <div style={{ marginTop: "var(--space-sm)" }}>
          <ReadAloud size="md" segments={readAloud} />
        </div>
      ) : null}
    </div>
  );
}
