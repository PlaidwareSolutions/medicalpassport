"use client";
import { useRef, type KeyboardEvent } from "react";

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
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = choices.findIndex((c) => c.value === value);

  /**
   * Roving tabindex (WAI-ARIA radiogroup pattern, docs/33 keyboard-navigation
   * rule): a screen reader announcing "radio button" expects arrow keys to
   * move both focus and selection within the group, not Tab through each
   * option individually. Only one option is ever a Tab stop.
   */
  function moveTo(index: number) {
    const next = choices[(index + choices.length) % choices.length]!;
    buttonRefs.current[(index + choices.length) % choices.length]?.focus();
    onChange(next.value);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveTo(index + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveTo(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveTo(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveTo(choices.length - 1);
    }
  }

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
        {choices.map((c, index) => {
          const selected = c.value === value;
          const isTabbable = selectedIndex === -1 ? index === 0 : selected;
          return (
            <button
              key={c.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={isTabbable ? 0 : -1}
              onClick={() => onChange(c.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
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
