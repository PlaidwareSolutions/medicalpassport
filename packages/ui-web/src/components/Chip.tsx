"use client";
import type { ReactNode } from "react";

export function Chip({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" | "danger" }) {
  const colors = {
    default: { bg: "var(--color-primary-soft)", fg: "var(--color-primary)" },
    success: { bg: "var(--color-success-soft)", fg: "var(--color-success)" },
    warning: { bg: "var(--color-warning-soft)", fg: "var(--color-warning)" },
    danger: { bg: "var(--color-danger-soft)", fg: "var(--color-danger)" },
  }[tone];
  return (
    <span
      style={{
        background: colors.bg,
        color: colors.fg,
        borderRadius: "999px",
        padding: "4px 12px",
        fontSize: "var(--font-small)",
        fontWeight: 600,
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}
