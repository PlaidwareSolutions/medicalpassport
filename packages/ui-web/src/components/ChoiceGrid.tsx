"use client";

export interface Choice<V extends string> {
  value: V;
  label: string;
  description?: string;
}

/**
 * Typing-free single-select grid (radiogroup) — the primary input pattern for
 * dose/frequency/food pickers (docs/18 minimal-typing rule).
 */
export function ChoiceGrid<V extends string>({
  label,
  choices,
  value,
  onChange,
  columns = 2,
}: {
  label: string;
  choices: Array<Choice<V>>;
  value: V | undefined;
  onChange: (v: V) => void;
  columns?: number;
}) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
      <legend style={{ fontSize: "var(--font-body)", fontWeight: 600, marginBottom: "var(--space-sm)" }}>
        {label}
      </legend>
      <div
        role="radiogroup"
        aria-label={label}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: "var(--size-touch-gap)",
        }}
      >
        {choices.map((c) => {
          const selected = c.value === value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(c.value)}
              style={{
                minHeight: "var(--size-touch)",
                padding: "var(--space-sm) var(--space-md)",
                borderRadius: "var(--radius-sm)",
                border: `2px solid ${selected ? "var(--color-primary)" : "var(--color-border)"}`,
                background: selected ? "var(--color-primary-soft)" : "var(--color-bg)",
                color: "var(--color-text)",
                fontSize: "var(--font-body)",
                fontFamily: "var(--font-family)",
                fontWeight: selected ? 700 : 400,
                textAlign: "start",
                cursor: "pointer",
              }}
            >
              <div>{c.label}</div>
              {c.description ? (
                <div style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)" }}>{c.description}</div>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
