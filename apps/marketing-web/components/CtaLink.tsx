import type { CSSProperties } from "react";
import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";

/** Approved attribution contract (OD-LP-8): one source value site-wide. */
export const APP_CTA_URL = "https://app.medidocs.app/?src=website";

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
  whiteSpace: "nowrap",
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
    <a href={APP_CTA_URL} style={style} className="mkt-cta">
      {t(locale, labelKey ?? (short ? "header.cta_short" : "hero.cta"))}
    </a>
  );
}
