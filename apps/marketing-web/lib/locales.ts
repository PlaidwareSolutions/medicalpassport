/**
 * Marketing locale architecture (OD-LP-4 + addendum).
 *
 * All four locales are supported architecturally from day one, but a locale
 * route is emitted and offered in the language switcher only once its
 * marketing translations have passed professional review. English is the only
 * published marketing locale at this stage. hi/te/ur copy is never
 * machine-translated and marked complete (owner ruling).
 *
 * Note this is deliberately distinct from the *product's* language support
 * (the app ships en/hi/te/ur today) — see the OD-LP-4 addendum's
 * product-language vs website-language distinction.
 */
export const MARKETING_LOCALES = ["en", "hi", "te", "ur"] as const;
export type MarketingLocale = (typeof MARKETING_LOCALES)[number];

/** Locales whose marketing translations passed professional review. */
export const PUBLISHED_LOCALES: readonly MarketingLocale[] = ["en"];

const RTL_LOCALES: readonly MarketingLocale[] = ["ur"];

export function direction(locale: MarketingLocale): "ltr" | "rtl" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

export function isMarketingLocale(value: string): value is MarketingLocale {
  return (MARKETING_LOCALES as readonly string[]).includes(value);
}

/** Route prefix for a locale: "" for en (apex), "/hi" etc. for the rest. */
export function localePath(locale: MarketingLocale): string {
  return locale === "en" ? "" : `/${locale}`;
}
