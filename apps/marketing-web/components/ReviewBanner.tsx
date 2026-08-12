import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";

/**
 * Slim staging-only strip shown on DRAFT (unreviewed) locale routes (Session 13
 * §56). It marks the page as a translation candidate for reviewers. It is only
 * rendered for non-published locales, which a production build never emits — so
 * it can never reach production content. Kept subtle so visual review of the
 * page underneath is unobstructed.
 */
export function ReviewBanner({ locale }: { locale: MarketingLocale }) {
  return (
    <div
      role="note"
      style={{
        background: "var(--mkt-ill-sand)",
        color: "var(--mkt-ink)",
        borderBottom: "1px solid var(--mkt-ill-clay)",
        textAlign: "center",
        fontSize: "0.8125rem",
        fontWeight: 600,
        padding: "6px 12px",
      }}
    >
      {t(locale, "review.banner")}
    </div>
  );
}
