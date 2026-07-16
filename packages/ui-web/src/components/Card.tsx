"use client";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: "default" | "danger" | "warning" | "info";
}

const tones: Record<NonNullable<CardProps["tone"]>, CSSProperties> = {
  default: { background: "var(--color-surface)", borderColor: "var(--color-border)" },
  danger: { background: "var(--color-danger-soft)", borderColor: "var(--color-danger)" },
  warning: { background: "var(--color-warning-soft)", borderColor: "var(--color-warning)" },
  info: { background: "var(--color-info-soft)", borderColor: "var(--color-info)" },
};

export function Card({ children, tone = "default", style, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      style={{
        border: "1px solid",
        borderRadius: "var(--radius)",
        padding: "var(--space-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </div>
  );
}
