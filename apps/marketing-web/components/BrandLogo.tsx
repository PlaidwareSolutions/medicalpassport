import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";

/**
 * The Medicine Passport brand lockup (owner-supplied logo, 2026-08-31):
 * mark + two-tone wordmark. The mark's geometry mirrors app/icon.svg (the
 * favicon) — keep the two in step. `mono` renders a single-ink variant for
 * quiet placements (footer): brand colors collapse to currentColor and the
 * white knockouts to the surface behind, so it inherits its surroundings.
 *
 * The wordmark is real HTML text (site font, localized brand.name), not
 * lettering baked into an image — it scales, translates, and mirrors under
 * RTL for free. Two-tone split: last word teal, rest navy (matches the
 * logo in en; degrades to a sensible split in hi/te/ur).
 */

const NAVY = "#17335F";
const TEAL = "#16A8A0";

export function BrandMark({ size = 30, mono }: { size?: number; mono?: boolean }) {
  const ink = mono ? "currentColor" : NAVY;
  const accent = mono ? "currentColor" : TEAL;
  const knock = mono ? "var(--mkt-surface)" : "#fff";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={{ display: "block", flexShrink: 0 }}>
      <rect x="7" y="3" width="42" height="56" rx="10" fill={ink} />
      <g stroke={knock} fill="none">
        <circle cx="28" cy="24" r="11.5" strokeWidth="3" />
        <ellipse cx="28" cy="24" rx="5.2" ry="11.5" strokeWidth="2.4" />
        <path d="M17.5 20h21M17.5 28h21" strokeWidth="2.4" />
      </g>
      <path d="M14 46h12M14 52h9" stroke={knock} strokeWidth="4" strokeLinecap="round" />
      <g transform="rotate(40 44 44)">
        <rect x="27" y="35.5" width="34" height="17" rx="8.5" fill="none" stroke={knock} strokeWidth="7" />
        <rect x="27" y="35.5" width="34" height="17" rx="8.5" fill={knock} />
        <path d="M44 35.5h8.5a8.5 8.5 0 0 1 0 17H44z" fill={accent} />
        <rect x="27" y="35.5" width="34" height="17" rx="8.5" fill="none" stroke={ink} strokeWidth="3" />
        <path d="M44 36.5v15" stroke={ink} strokeWidth="3" />
      </g>
    </svg>
  );
}

export function BrandWordmark({
  locale,
  fontSize = "1.125rem",
  mono,
}: {
  locale: MarketingLocale;
  fontSize?: string;
  mono?: boolean;
}) {
  const name = t(locale, "brand.name");
  const i = name.lastIndexOf(" ");
  const head = i > 0 ? name.slice(0, i) : name;
  const tail = i > 0 ? name.slice(i + 1) : "";
  return (
    <span style={{ fontWeight: 800, fontSize, letterSpacing: "-0.01em", color: mono ? "inherit" : NAVY, whiteSpace: "nowrap" }}>
      {head}
      {tail ? (
        <>
          {" "}
          <span style={{ color: mono ? "inherit" : TEAL }}>{tail}</span>
        </>
      ) : null}
    </span>
  );
}
