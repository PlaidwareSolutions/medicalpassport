import type { ReactNode } from "react";

/** Non-interactive trust/value chip (docs/landing-page/05 §6). */
export function Chip({ children, onPrimary }: { children: ReactNode; onPrimary?: boolean }) {
  return (
    <li
      style={{
        display: "inline-block",
        background: onPrimary ? "rgba(255,255,255,.14)" : "var(--mkt-soft)",
        color: onPrimary ? "#ffffff" : "var(--mkt-ink)",
        borderRadius: "999px",
        padding: "8px 14px",
        fontWeight: 600,
        fontSize: "0.875rem",
        lineHeight: 1.3,
      }}
    >
      {children}
    </li>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ul
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}
    >
      {children}
    </ul>
  );
}
