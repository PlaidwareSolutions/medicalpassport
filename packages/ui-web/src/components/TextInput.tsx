"use client";
import { useId, type InputHTMLAttributes } from "react";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  help?: string;
  error?: string;
}

/** Labeled input — the label prop is mandatory so fields are never unlabeled. */
export function TextInput({ label, help, error, id, style, ...rest }: TextInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <label htmlFor={inputId} style={{ fontSize: "var(--font-body)", fontWeight: 600, color: "var(--color-text)" }}>
        {label}
      </label>
      {help ? (
        <span id={helpId} style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
          {help}
        </span>
      ) : null}
      <input
        id={inputId}
        aria-describedby={help ? helpId : undefined}
        aria-errormessage={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        {...rest}
        style={{
          minHeight: "var(--size-touch)",
          padding: "0 var(--space-md)",
          borderRadius: "var(--radius-sm)",
          border: `2px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
          fontSize: "var(--font-large)",
          fontFamily: "var(--font-family)",
          color: "var(--color-text)",
          background: "var(--color-bg)",
          ...style,
        }}
      />
      {error ? (
        <span id={errorId} role="alert" style={{ fontSize: "var(--font-small)", color: "var(--color-danger)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
