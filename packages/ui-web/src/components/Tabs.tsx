"use client";
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
}

/**
 * Shared tab strip (WAI-ARIA tabs pattern, docs/33 keyboard-navigation rule):
 * roving tabindex, arrow keys move both focus and selection — same behaviour
 * as ChoiceGrid's radiogroup. Replaces the ad-hoc per-page tab rows.
 *
 * Reflow (docs/33: 200% zoom at 320px): the strip wraps instead of forcing
 * the page wider, and each tab may shrink below its min-content width.
 *
 * Pass `panelId` when the tab panel element carries the matching id and
 * role="tabpanel"; each tab then references it via aria-controls, and the
 * panel should point back with aria-labelledby={tabId(key)}.
 */
export function Tabs<K extends string>({
  tabs,
  value,
  onChange,
  label,
  panelId,
}: {
  tabs: Array<TabItem<K>>;
  value: K;
  onChange: (k: K) => void;
  /** Accessible name for the tablist. */
  label?: string;
  /** id of the visible tab panel, wired onto each tab as aria-controls. */
  panelId?: (key: K) => string;
}) {
  const idBase = useId();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabId = (key: K) => `${idBase}-tab-${key}`;

  function moveTo(index: number) {
    const i = (index + tabs.length) % tabs.length;
    buttonRefs.current[i]?.focus();
    onChange(tabs[i]!.key);
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
      moveTo(tabs.length - 1);
    }
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--size-touch-gap)",
        marginBottom: "var(--space-md)",
      }}
    >
      {tabs.map((tab, index) => {
        const selected = tab.key === value;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={tabId(tab.key)}
            aria-selected={selected}
            aria-controls={panelId ? panelId(tab.key) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            style={{
              flex: "1 1 auto",
              minWidth: 0,
              minHeight: "var(--size-touch)",
              padding: "var(--space-xs) var(--space-sm)",
              borderRadius: "var(--radius-sm)",
              border: `2px solid ${selected ? "var(--color-primary)" : "var(--color-border)"}`,
              background: selected ? "var(--color-primary-soft)" : "var(--color-bg)",
              color: "var(--color-text)",
              fontWeight: selected ? 700 : 400,
              fontSize: "var(--font-body)",
              fontFamily: "var(--font-family)",
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
