"use client";
import type { ReactNode } from "react";

/** Status banner rendered as an ARIA live region (docs/33 screen-reader rules). */
export function Banner({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warning" | "danger" | "success" }) {
  const colors = {
    info: { bg: "var(--color-info-soft)", fg: "var(--color-info)" },
    warning: { bg: "var(--color-warning-soft)", fg: "var(--color-warning)" },
    danger: { bg: "var(--color-danger-soft)", fg: "var(--color-danger)" },
    success: { bg: "var(--color-success-soft)", fg: "var(--color-success)" },
  }[tone];
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        background: colors.bg,
        color: colors.fg,
        padding: "var(--space-sm) var(--space-md)",
        borderRadius: "var(--radius-sm)",
        fontSize: "var(--font-small)",
        fontWeight: 600,
      }}
    >
      {children}
    </div>
  );
}
