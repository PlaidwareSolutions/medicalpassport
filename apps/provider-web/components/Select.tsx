"use client";
import { useId, type SelectHTMLAttributes } from "react";

export interface SelectOption<V extends string> {
  value: V;
  label: string;
}

export interface SelectProps<V extends string> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> {
  label: string;
  help?: string;
  error?: string;
  options: ReadonlyArray<SelectOption<V>>;
  value: V | "";
  onChange: (value: V | "") => void;
  placeholder?: string;
}

/** Labeled native select at the 48px touch size — keyboard and screen-reader behaviour for free. */
export function Select<V extends string>({ label, help, error, options, value, onChange, placeholder, id, style, ...rest }: SelectProps<V>) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const helpId = `${selectId}-help`;
  const errorId = `${selectId}-error`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <label htmlFor={selectId} style={{ fontSize: "var(--font-body)", fontWeight: 600, color: "var(--color-text)" }}>
        {label}
      </label>
      {help ? (
        <span id={helpId} style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>
          {help}
        </span>
      ) : null}
      <select
        id={selectId}
        aria-describedby={help ? helpId : undefined}
        aria-errormessage={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value as V | "")}
        {...rest}
        style={{
          minHeight: "var(--size-touch)",
          padding: "0 var(--space-md)",
          borderRadius: "var(--radius-sm)",
          border: `2px solid ${error ? "var(--color-danger)" : "var(--color-border)"}`,
          fontSize: "var(--font-body)",
          fontFamily: "var(--font-family)",
          color: "var(--color-text)",
          background: "var(--color-bg)",
          ...style,
        }}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={errorId} role="alert" style={{ fontSize: "var(--font-small)", color: "var(--color-danger)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
