import { t } from "../lib/i18n";
import { PUBLISHED_LOCALES, localePath, type MarketingLocale } from "../lib/locales";
import { PROFESSIONAL_UNIT_ENABLED } from "../lib/release-flags";
import { BrandMark, BrandWordmark } from "./BrandLogo";
import { APP_ORIGIN, CtaLink } from "./CtaLink";
import { HeaderStickyCta } from "./HeaderStickyCta";
import { LocaleSwitcher } from "./LocaleSwitcher";

// Re-exported for the Hero section, which places the sentinel this observes.
export { HERO_CTA_SENTINEL_ID } from "./HeaderStickyCta";

/**
 * Sticky header — a SERVER component so all copy is localized at build time and
 * the multilingual dictionaries never ship to the client (§44). The only client
 * behaviour (revealing the CTA after the hero CTA scrolls away) lives in the
 * tiny HeaderStickyCta wrapper, which receives the already-rendered CTA.
 *
 * Locale UI: a static chip while exactly one marketing locale is offered (a
 * one-entry menu reads as broken — wireframes §7.2); a real language switcher
 * once this build emits more than one locale (staging drafts, or published).
 */
export function SiteHeader({
  locale,
  availableLocales = PUBLISHED_LOCALES,
}: {
  locale: MarketingLocale;
  availableLocales?: readonly MarketingLocale[];
}) {
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
          style={{ textDecoration: "none", lineHeight: 1.1, display: "flex", alignItems: "center", gap: "10px" }}
          aria-label={`${t(locale, "brand.name")} — ${t(locale, "brand.endorsement")}`}
        >
          <BrandMark size={34} />
          <span style={{ display: "block" }}>
            <BrandWordmark locale={locale} />
            <span className="mkt-muted" style={{ display: "block", fontSize: "0.75rem", fontWeight: 500 }}>
              {t(locale, "brand.endorsement")}
            </span>
          </span>
        </a>
        <nav style={{ display: "flex", alignItems: "center", gap: "18px" }} aria-label="Site">
          {PROFESSIONAL_UNIT_ENABLED ? (
            <a className="mkt-muted mkt-nav-quiet mkt-desktop-only" href="/for-clinics/" style={{ textDecoration: "none", fontWeight: 600, fontSize: "0.9375rem" }}>
              {t(locale, "nav.for_clinics")}
            </a>
          ) : null}
          <a
            className="mkt-muted mkt-nav-quiet mkt-desktop-only"
            href={`${APP_ORIGIN}/help`}
            style={{ textDecoration: "none", fontWeight: 600, fontSize: "0.9375rem" }}
          >
            {t(locale, "nav.help")}
          </a>
          {availableLocales.length > 1 ? (
            <LocaleSwitcher locale={locale} availableLocales={availableLocales} />
          ) : (
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
          <HeaderStickyCta>
            <CtaLink locale={locale} short />
          </HeaderStickyCta>
        </nav>
      </div>
    </header>
  );
}
