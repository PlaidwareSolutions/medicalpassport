import { t } from "../lib/i18n";
import type { MarketingLocale } from "../lib/locales";
import { PhoneFrame } from "./ProductMedia";

/**
 * Intentional media placeholder (Session 7 §24): reserves the final 390/780
 * aspect ratio (zero CLS on replacement), visibly communicates that a real
 * product demonstration belongs here (badge + play motif + label), and never
 * pretends to be final media or fake UI. Sessions 8–9 swap the inner
 * placeholder for <ProductMedia sources={...} poster={...}> with no layout
 * change. Works identically under reduced motion and Save-Data (it is
 * static content).
 */
export function PlaceholderMedia({ locale, label }: { locale: MarketingLocale; label: string }) {
  return (
    <PhoneFrame>
      <div className="mkt-ph" role="img" aria-label={label}>
        <span className="mkt-ph-badge">{t(locale, "media.placeholder_badge")}</span>
        <span className="mkt-ph-play" aria-hidden="true">
          ▶
        </span>
        <p style={{ fontSize: "0.875rem", fontWeight: 600, maxWidth: "24ch" }}>{label}</p>
        <p className="mkt-muted" style={{ fontSize: "0.75rem", maxWidth: "26ch" }}>
          {t(locale, "hero.media_note")}
        </p>
      </div>
    </PhoneFrame>
  );
}
