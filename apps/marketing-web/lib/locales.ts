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

/**
 * Locales whose ROUTES are emitted in THIS build (the publication gate is the
 * emitted route set, not the presence of a dictionary):
 *   - production build → only PUBLISHED_LOCALES (professionally reviewed);
 *   - staging build (MARKETING_ENV=staging) → all MARKETING_LOCALES, so
 *     reviewers can see the draft hi/te/ur candidates. Staging stays globally
 *     noindexed, and a production build never emits an unreviewed locale.
 */
export function buildLocales(): readonly MarketingLocale[] {
  return process.env.MARKETING_ENV === "staging" ? MARKETING_LOCALES : PUBLISHED_LOCALES;
}

/** Non-English locales to statically generate in this build. */
export function nonEnglishBuildLocales(): MarketingLocale[] {
  return buildLocales().filter((l) => l !== "en");
}

/**
 * Static params for the [locale] dynamic route. `output: export` cannot export
 * a dynamic route with zero params, so this ALWAYS returns the architectural
 * non-English locales (never empty). In a production build the unpublished
 * ones render as notFound() 404 stubs and are removed from the artifact by
 * scripts/prune-draft-locales.mjs; in a staging build (MARKETING_ENV=staging)
 * they render as the draft review pages. The publication gate stays the emitted
 * artifact — buildLocales()/PUBLISHED_LOCALES decide what actually ships.
 */
export function localeStaticParams(): { locale: string }[] {
  return MARKETING_LOCALES.filter((l) => l !== "en").map((locale) => ({ locale }));
}
