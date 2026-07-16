"use client";
import type { ReactNode } from "react";

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "var(--font-large)",
        fontWeight: 700,
        color: "var(--color-text)",
        margin: "var(--space-md) 0 var(--space-sm)",
      }}
    >
      {children}
    </h2>
  );
}
