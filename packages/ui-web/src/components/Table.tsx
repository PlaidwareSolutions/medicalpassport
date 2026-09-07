"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: ReactNode;
  onRowClick?: (row: T) => void;
  /**
   * Narrowest the table may be drawn (px) before its own scroller takes
   * over. Without it a table with controls in the last columns squeezes
   * them to nothing on a phone rather than scrolling.
   */
  minWidth?: number;
  /** Shown only while the table really is wider than its box — a scrollbar alone is invisible on a touch screen. */
  scrollHint?: ReactNode;
}

/** Minimal, design-token-styled data table for the admin portal — an
 * internal tool, so density over touch-target size (unlike patient-web's
 * Card-based lists). */
export function Table<T>({ columns, rows, rowKey, emptyLabel, onRowClick, minWidth, scrollHint }: TableProps<T>) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const el = scroller.current;
    setOverflowing(!!el && el.scrollWidth > el.clientWidth + 1);
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, rows, columns]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: "var(--space-lg)", textAlign: "center", color: "var(--color-text-muted)" }}>
        {emptyLabel ?? "Nothing to show"}
      </div>
    );
  }

  return (
    <>
      <div ref={scroller} style={{ overflowX: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
        <table style={{ width: "100%", minWidth, borderCollapse: "collapse", fontSize: "var(--font-small)" }}>
        <thead>
          <tr style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
            {columns.map((col) => (
              <th key={col.key} style={{ textAlign: "left", padding: "var(--space-sm) var(--space-md)", color: "var(--color-text-muted)", fontWeight: 600 }}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{ borderBottom: "1px solid var(--color-border)", cursor: onRowClick ? "pointer" : "default" }}
            >
              {columns.map((col) => (
                <td key={col.key} style={{ padding: "var(--space-sm) var(--space-md)", color: "var(--color-text)" }}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      {scrollHint && overflowing ? (
        <p style={{ margin: "var(--space-xs) 0 0", fontSize: "var(--font-small)", color: "var(--color-text-muted)" }} data-testid="table-scroll-hint">
          {scrollHint}
        </p>
      ) : null}
    </>
  );
}
