"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { direction } from "@medpass/localization";
import { Card } from "@medpass/ui-web";
import { GuideGlyph, type GuideGlyphName } from "./GuideGlyph";
import { useI18n } from "../lib/i18n";

/**
 * One navigation row on the Profile hub: a tinted glyph badge, a bold label,
 * and a direction-aware chevron. The glyph is decorative (aria-hidden inside
 * GuideGlyph) — the text label carries the meaning (docs/33); the chevron
 * flips for RTL because "forward" points the other way in Urdu.
 */
export function ProfileLink({ href, glyph, label, sub }: { href: string; glyph: GuideGlyphName; label: string; sub?: ReactNode }) {
  const { locale } = useI18n();
  const rtl = direction(locale) === "rtl";

  return (
    <Link href={href}>
      <Card style={{ flexDirection: "row", alignItems: "center", gap: "var(--space-md)" }}>
        <span
          style={{
            width: "2.6em",
            height: "2.6em",
            borderRadius: "50%",
            background: "var(--color-primary-soft)",
            color: "var(--color-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <GuideGlyph name={glyph} size="md" />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ display: "block" }}>{label}</strong>
          {sub ? <span style={{ color: "var(--color-text-muted)", fontSize: "var(--font-small)" }}>{sub}</span> : null}
        </span>
        <svg
          width="0.9em"
          height="0.9em"
          viewBox="0 0 100 100"
          aria-hidden="true"
          focusable="false"
          style={{ flexShrink: 0, color: "var(--color-text-muted)", transform: rtl ? "scaleX(-1)" : undefined }}
        >
          <path d="M34 14l36 36-36 36" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Card>
    </Link>
  );
}
