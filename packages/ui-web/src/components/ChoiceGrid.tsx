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
  minItemWidth = 0,
}: {
  label: string;
  choices: Array<Choice<V>>;
  value: V | undefined;
  onChange: (v: V) => void;
  columns?: number;
  /**
   * The narrowest a choice may get before the grid drops to fewer columns
   * (px). `columns` becomes a maximum rather than a fixed count: on a wide
   * enough row the grid is exactly `columns` wide, and on a 390px phone it
   * reflows instead of squeezing "Unit (injection)" into 48px of content
   * box. 0 (the default) keeps the fixed grid, so existing callers are
   * unaffected until they choose a width.
   */
  minItemWidth?: number;
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
          // minmax(0, …), not bare 1fr: bare 1fr floors each column at its
          // min-content width, which overflows 320px at 200% zoom (docs/33).
          //
          // The track minimum is the LARGER of `minItemWidth` and the width
          // an exact-`columns` row would give, capped at 100%. Where the row
          // is wide enough that is the exact-columns width, so auto-fit lays
          // out exactly `columns` per row as before; where it is not, the
          // grid drops to as many columns as still fit at `minItemWidth`.
          gridTemplateColumns: minItemWidth
            ? `repeat(auto-fit, minmax(min(100%, max(${minItemWidth}px, (100% - ${columns - 1} * var(--size-touch-gap)) / ${columns})), 1fr))`
            : `repeat(${columns}, minmax(0, 1fr))`,
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
              {/* A label the row cannot fit wraps and, failing that, breaks:
                  a clipped "Unit (injection)" is a choice the reader cannot
                  identify. */}
              <div style={{ overflowWrap: "anywhere" }}>{c.label}</div>
              {c.description ? (
                <div style={{ fontSize: "var(--font-small)", color: "var(--color-text-muted)", overflowWrap: "anywhere" }}>{c.description}</div>
              ) : null}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
