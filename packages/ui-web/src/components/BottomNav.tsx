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
 */
export function BottomNav({ items, renderLink }: { items: BottomNavItem[]; renderLink: (item: BottomNavItem, children: ReactNode) => ReactNode }) {
  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed",
        bottom: 0,
        insetInlineStart: 0,
        insetInlineEnd: 0,
        height: "calc(var(--bottom-nav-height) + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--color-bg)",
        borderTop: "1px solid var(--color-border)",
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, 1fr)`,
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
              height: "var(--bottom-nav-height)",
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
