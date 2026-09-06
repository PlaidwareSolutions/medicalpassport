"use client";
import { useId, type TextareaHTMLAttributes } from "react";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  help?: string;
  error?: string;
}

/** Labeled multi-line input, same visual contract as ui-web's TextInput. */
export function TextArea({ label, help, error, id, style, rows = 3, ...rest }: TextAreaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const helpId = `${areaId}-help`;
  const errorId = `${areaId}-error`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <label htmlFor={areaId} style={{ fontSize: "var(--font-body)", fontWeight: 600, color: "var(--color-text)" }}>
        {label}
      </label>
      {help ? (
        <span id={helpId} style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
          {help}
        </span>
      ) : null}
      <textarea
        id={areaId}
        rows={rows}
        aria-describedby={help ? helpId : undefined}
        aria-errormessage={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        {...rest}
        style={{
          minHeight: "var(--size-touch)",
          padding: "var(--space-sm) var(--space-md)",
          borderRadius: "var(--radius-sm)",
          border: `2px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
          fontSize: "var(--font-body)",
          fontFamily: "var(--font-family)",
          color: "var(--color-text)",
          background: "var(--color-bg)",
          resize: "vertical",
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
