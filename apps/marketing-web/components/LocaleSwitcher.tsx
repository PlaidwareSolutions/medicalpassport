import { t } from "../lib/i18n";
import { direction, localePath, type MarketingLocale } from "../lib/locales";

/**
 * Language selector (Session 13 §28). Native <details>/<summary> disclosure —
 * keyboard accessible with no JavaScript, works at 320px and under RTL. Shows
 * language autonyms (a language's own name), never flags (language ≠ country).
 * Static links to each locale home; the publication gate decides which locales
 * are offered (availableLocales = buildLocales()).
 */
const AUTONYM: Record<MarketingLocale, string> = {
  en: "English",
  hi: "हिंदी",
  te: "తెలుగు",
  ur: "اردو",
};

export function LocaleSwitcher({
  locale,
  availableLocales,
}: {
  locale: MarketingLocale;
  availableLocales: readonly MarketingLocale[];
}) {
  return (
    <details className="mkt-lang">
      <summary
        className="mkt-lang-summary"
        aria-label={`${t(locale, "footer.language")}: ${AUTONYM[locale]}`}
      >
        <span aria-hidden="true" lang={locale} dir={direction(locale)}>
          {AUTONYM[locale]}
        </span>
        <span aria-hidden="true" className="mkt-lang-caret">▾</span>
      </summary>
      <ul className="mkt-lang-menu" role="list">
        {availableLocales.map((l) => (
          <li key={l}>
            <a
              href={`${localePath(l)}/`}
              lang={l}
              dir={direction(l)}
              aria-current={l === locale ? "true" : undefined}
              className="mkt-lang-item"
            >
              {AUTONYM[l]}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
