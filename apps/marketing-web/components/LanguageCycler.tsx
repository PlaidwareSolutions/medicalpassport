"use client";

import { useEffect, useState } from "react";

/**
 * Cycles the four app-language names inside the hero chip so the
 * multilingual promise is SHOWN, not just listed. Progressive enhancement:
 * server-renders (and keeps, under reduced motion or before hydration) the
 * full static list; the full list also stays the accessible name. An
 * inline-grid stacks all four words in one cell so the chip keeps the width
 * of the widest word — cycling never reflows the row.
 */
const WORDS = ["English", "हिंदी", "తెలుగు", "اردو"];
const INTERVAL_MS = 2200;

export function LanguageCycler({ fullText }: { fullText: string }) {
  const [index, setIndex] = useState(-1); // -1 = static full text

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setIndex(0);
    const timer = setInterval(() => setIndex((i) => (i + 1) % WORDS.length), INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  if (index < 0) return <>{fullText}</>;

  const prefix = fullText.split(":")[0];
  return (
    <span aria-label={fullText}>
      <span aria-hidden="true">
        {prefix}:{" "}
        <span style={{ display: "inline-grid", verticalAlign: "bottom" }}>
          {WORDS.map((w, i) => (
            <span
              key={w}
              style={{
                gridArea: "1 / 1",
                whiteSpace: "nowrap",
                textAlign: "center",
                transition: "opacity .45s ease",
                opacity: i === index ? 1 : 0,
                color: "var(--mkt-primary)",
              }}
            >
              {w}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
