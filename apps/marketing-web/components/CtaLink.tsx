import type { CSSProperties } from "react";
import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";

/** Approved attribution contract (OD-LP-8): one source value site-wide. */
export const APP_CTA_URL = "https://app.medidocs.app/?src=website";

/**
 * App CTA URL with an optional locale hint (Session 17 marketing→app handoff).
 * English uses the bare attribution URL; a non-English marketing route appends
 * `&lang=<locale>` so a NEW patient (no stored preference) starts in that
 * language. The app allowlists en|hi|te|ur and ignores anything else; `src` is
 * unchanged (attribution stays independent of language). Dormant in production
 * while only English is published (PUBLISHED_LOCALES = en).
 */
export function appCtaUrl(locale: MarketingLocale): string {
  return locale === "en" ? APP_CTA_URL : `${APP_CTA_URL}&lang=${locale}`;
}

const base: CSSProperties = {
  display: "inline-block",
  background: "var(--mkt-primary)",
  color: "#ffffff",
  borderRadius: "var(--radius)",
  minHeight: "var(--size-touch)",
  padding: "13px 22px",
  fontWeight: 700,
  fontSize: "1rem",
  lineHeight: 1.3,
  textDecoration: "none",
  textAlign: "center",
  // No nowrap + cap at container width: long labels (the caregiving variant
  // CTA) wrap instead of overflowing the 320px viewport.
  maxWidth: "100%",
};

export function CtaLink({
  locale,
  wide,
  invert,
  short,
  labelKey,
}: {
  locale: MarketingLocale;
  wide?: boolean;
  invert?: boolean;
  short?: boolean;
  labelKey?: Parameters<typeof t>[1];
}) {
  const style: CSSProperties = {
    ...base,
    ...(wide ? { display: "block", width: "100%" } : {}),
    ...(invert ? { background: "#ffffff", color: "var(--mkt-primary)" } : {}),
  };
  return (
    <a href={appCtaUrl(locale)} style={style} className="mkt-cta">
      {t(locale, labelKey ?? (short ? "header.cta_short" : "hero.cta"))}
    </a>
  );
}
