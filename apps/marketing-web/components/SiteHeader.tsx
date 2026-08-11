"use client";

import { useEffect, useState } from "react";
import { t } from "../lib/i18n";
import { PUBLISHED_LOCALES, localePath, type MarketingLocale } from "../lib/locales";
import { PROFESSIONAL_UNIT_ENABLED } from "../lib/release-flags";
import { CtaLink } from "./CtaLink";

export const HERO_CTA_SENTINEL_ID = "hero-cta-sentinel";

/**
 * Sticky header. The CTA appears only after the hero's own CTA leaves view
 * (approved wireframe rule); pages without a hero sentinel show it always.
 * Locale UI: static chip while exactly one marketing locale is published
 * (a one-entry dropdown reads as broken — wireframes §7.2); becomes a menu
 * when the second reviewed locale publishes.
 */
export function SiteHeader({ locale }: { locale: MarketingLocale }) {
  const [showCta, setShowCta] = useState(false);

  useEffect(() => {
    const sentinel = document.getElementById(HERO_CTA_SENTINEL_ID);
    if (!sentinel) {
      setShowCta(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry) setShowCta(!entry.isIntersecting);
    });
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        background: "color-mix(in srgb, var(--mkt-paper) 96%, transparent)",
        borderBottom: "1px solid var(--mkt-hairline)",
      }}
    >
      <div
        className="mkt-container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          paddingBlock: "10px",
          minHeight: "var(--size-touch)",
        }}
      >
        <a
          href={`${localePath(locale)}/`}
          style={{ textDecoration: "none", lineHeight: 1.1 }}
          aria-label={`${t(locale, "brand.name")} — ${t(locale, "brand.endorsement")}`}
        >
          <span style={{ display: "block", fontWeight: 800, fontSize: "1.125rem", color: "var(--mkt-primary)" }}>
            {t(locale, "brand.name")}
          </span>
          <span className="mkt-muted" style={{ display: "block", fontSize: "0.75rem", fontWeight: 500 }}>
            {t(locale, "brand.endorsement")}
          </span>
        </a>
        <nav style={{ display: "flex", alignItems: "center", gap: "18px" }} aria-label="Site">
          {PROFESSIONAL_UNIT_ENABLED ? (
            <a className="mkt-muted mkt-nav-quiet" href="/for-clinics/" style={{ textDecoration: "none", fontWeight: 600, fontSize: "0.9375rem" }}>
              {t(locale, "nav.for_clinics")}
            </a>
          ) : null}
          <a
            className="mkt-muted mkt-nav-quiet mkt-desktop-only"
            href="https://app.medidocs.app/help"
            style={{ textDecoration: "none", fontWeight: 600, fontSize: "0.9375rem" }}
          >
            {t(locale, "nav.help")}
          </a>
          {PUBLISHED_LOCALES.length > 1 ? null : (
            <span
              aria-label={t(locale, "footer.language")}
              style={{
                border: "1px solid var(--mkt-hairline)",
                borderRadius: "999px",
                padding: "5px 12px",
                fontWeight: 600,
                fontSize: "0.8125rem",
                background: "var(--mkt-surface)",
              }}
            >
              {locale.toUpperCase()}
            </span>
          )}
          {showCta ? <CtaLink locale={locale} short /> : null}
        </nav>
      </div>
    </header>
  );
}
