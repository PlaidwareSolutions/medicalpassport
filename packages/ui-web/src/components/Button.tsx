"use client";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  fullWidth?: boolean;
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

/** Touch-first button: 48px minimum target, always labeled by its children. */
export function Button({ variant = "primary", fullWidth, children, style, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        ...base,
        ...variants[variant],
        ...(fullWidth ? { width: "100%" } : {}),
        ...(disabled ? { opacity: 0.55, cursor: "not-allowed" } : {}),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
