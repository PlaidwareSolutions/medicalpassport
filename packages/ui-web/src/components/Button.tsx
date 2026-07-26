"use client";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { PillSpinner } from "./PillSpinner";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  fullWidth?: boolean;
  /** Shows a small spinner alongside the label and forces disabled — for the one button that actually triggered an in-flight action (not siblings merely disabled while it runs). */
  loading?: boolean;
  children: ReactNode;
}

const base: CSSProperties = {
  minHeight: "var(--size-touch)",
  padding: "0 var(--space-md)",
  borderRadius: "var(--radius)",
  fontSize: "var(--font-body)",
  fontFamily: "var(--font-family)",
  fontWeight: 600,
  border: "1px solid transparent",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-sm)",
};

const variants: Record<NonNullable<ButtonProps["variant"]>, CSSProperties> = {
  primary: { background: "var(--color-primary)", color: "var(--color-primary-contrast)" },
  secondary: {
    background: "var(--color-bg)",
    color: "var(--color-primary)",
    borderColor: "var(--color-primary)",
  },
  danger: { background: "var(--color-danger)", color: "#fff" },
  ghost: { background: "transparent", color: "var(--color-primary)" },
};

/** Solid-background variants need a white-toned spinner; light-background ones keep the brand-green two-tone. */
const SPINNER_TONE: Record<NonNullable<ButtonProps["variant"]>, "brand" | "onDark"> = {
  primary: "onDark",
  danger: "onDark",
  secondary: "brand",
  ghost: "brand",
};

/** Touch-first button: 48px minimum target, always labeled by its children. */
export function Button({ variant = "primary", fullWidth, loading, children, style, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      style={{
        ...base,
        ...variants[variant],
        ...(fullWidth ? { width: "100%" } : {}),
        ...(disabled || loading ? { opacity: 0.55, cursor: "not-allowed" } : {}),
        ...style,
      }}
    >
      {loading ? <PillSpinner size="sm" tone={SPINNER_TONE[variant]} /> : null}
      {children}
    </button>
  );
}
