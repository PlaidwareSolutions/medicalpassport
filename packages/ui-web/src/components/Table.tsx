"use client";
import type { ReactNode } from "react";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyLabel?: string;
  onRowClick?: (row: T) => void;
}

/** Minimal, design-token-styled data table for the admin portal — an
 * internal tool, so density over touch-target size (unlike patient-web's
 * Card-based lists). */
export function Table<T>({ columns, rows, rowKey, emptyLabel, onRowClick }: TableProps<T>) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: "var(--space-lg)", textAlign: "center", color: "var(--color-text-muted)" }}>
        {emptyLabel ?? "Nothing to show"}
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--font-small)" }}>
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
  );
}
