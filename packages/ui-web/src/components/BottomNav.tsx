"use client";
import type { ReactNode } from "react";

export interface BottomNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  href: string;
  active: boolean;
}

/**
 * Thumb-reachable bottom navigation (docs/06). Icons always paired with
 * labels; safe-area inset respected for standalone PWA mode.
 *
 * Sticky-in-flow rather than position:fixed so the bar occupies real layout
 * space and may grow taller than --bottom-nav-height when text does — at 200%
 * zoom on a 320px viewport (docs/33 reflow requirement) the auto-fit grid
 * reflows the five links onto two rows instead of overflowing sideways. The
 * shell that renders it (AppShell) makes it the last child of a flex column.
 */
export function BottomNav({ items, renderLink }: { items: BottomNavItem[]; renderLink: (item: BottomNavItem, children: ReactNode) => ReactNode }) {
  return (
    <nav
      aria-label="Main"
      style={{
        position: "sticky",
        bottom: 0,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--color-bg)",
        borderTop: "1px solid var(--color-border)",
        display: "grid",
        // min(100%, 3.3rem): one row of five at normal text size (5 × 52.8px
        // fits 320px); at 200% the rem minimum doubles to ~106px and the same
        // five links reflow to a 3 + 2 grid instead of overflowing sideways.
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 3.3rem), 1fr))",
        zIndex: 10,
      }}
    >
      {items.map((item) =>
        renderLink(
          item,
          <span
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              minHeight: "var(--bottom-nav-height)",
              minWidth: 0,
              padding: "var(--space-xs)",
              textAlign: "center",
              overflowWrap: "anywhere",
              color: item.active ? "var(--color-primary)" : "var(--color-text-muted)",
              fontSize: "var(--font-small)",
              fontWeight: item.active ? 700 : 500,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: "1.4rem", lineHeight: 1 }}>
              {item.icon}
            </span>
            {item.label}
          </span>,
        ),
      )}
    </nav>
  );
}
