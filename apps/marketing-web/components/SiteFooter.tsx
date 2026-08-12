import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";
import { PROFESSIONAL_UNIT_ENABLED } from "../lib/release-flags";

/**
 * Footer shell. Contact addresses are intentionally absent until OD-LP-7
 * (support/privacy channel ownership) is resolved — publishing unmonitored
 * contact information is prohibited by SPEC §27.
 *
 * Legal links always target the English /privacy/ and /terms/ pages — there are
 * no translated legal policies (Session 13 §51: the controlling English legal
 * text is still DRAFT and unapproved). On non-English pages the link marks that
 * the linked policy is in English, e.g. "Privacy (English)".
 */
export function SiteFooter({ locale }: { locale: MarketingLocale }) {
  const legalLabel = (key: "footer.privacy" | "footer.terms") =>
    locale === "en" ? t(locale, key) : `${t(locale, key)} (${t(locale, "footer.english")})`;
  return (
    <footer style={{ background: "var(--mkt-surface)", borderTop: "1px solid var(--mkt-hairline)" }}>
      <div
        className="mkt-container"
        style={{ display: "flex", flexWrap: "wrap", gap: "24px", justifyContent: "space-between", paddingBlock: "32px" }}
      >
        <nav aria-label="Legal" style={{ display: "flex", flexWrap: "wrap", gap: "20px" }}>
          {PROFESSIONAL_UNIT_ENABLED ? (
            <a href="/for-clinics/" style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
              {t(locale, "nav.for_clinics")}
            </a>
          ) : null}
          <a href="/privacy/" style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
            {legalLabel("footer.privacy")}
          </a>
          <a href="/terms/" style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
            {legalLabel("footer.terms")}
          </a>
        </nav>
        <p className="mkt-muted" style={{ fontSize: "0.875rem" }}>
          {t(locale, "brand.company_line")}
        </p>
      </div>
    </footer>
  );
}
