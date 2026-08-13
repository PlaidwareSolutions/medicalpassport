import type { Metadata } from "next";
import { PUBLISHED_LOCALES, localePath, type MarketingLocale } from "./locales";
import { IS_SOFT_LAUNCH } from "./release-mode";

export const SITE_ORIGIN = "https://medidocs.app";

/** OG locale codes (language_TERRITORY); India-first audience. */
const OG_LOCALE: Record<MarketingLocale, string> = {
  en: "en_IN",
  hi: "hi_IN",
  te: "te_IN",
  ur: "ur_IN",
};

/**
 * Per-locale metadata (docs/landing-page/03 §7). hreflang alternates, canonical
 * languages map, and OG alternateLocale are all keyed on PUBLISHED_LOCALES only,
 * so unreviewed draft locales are never advertised to crawlers (staging is
 * globally noindexed regardless; draft locale pages also set page-level
 * robots.index=false). A single-locale alternates block is omitted as noise.
 * OG imagery deliberately has no og:image yet (Session 4 ruling — authentic
 * product lockup produced with the media phase, not fabricated).
 */
export function pageMetadata(
  locale: MarketingLocale,
  path: "" | "privacy" | "terms",
  title: string,
  description: string,
): Metadata {
  const route = `${localePath(locale)}/${path}${path ? "/" : ""}`;
  const canonical = `${SITE_ORIGIN}${route === "/" ? "/" : route}`;
  const languages =
    PUBLISHED_LOCALES.length > 1
      ? Object.fromEntries(
          PUBLISHED_LOCALES.map((l) => [l, `${SITE_ORIGIN}${localePath(l)}/${path}${path ? "/" : ""}`]),
        )
      : undefined;
  const alternateLocale = PUBLISHED_LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]);
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    // Controlled soft launch (Session 19): page-level noindex on EVERY route as
    // defence in depth behind the authoritative X-Robots-Tag header (§10). The
    // final public-launch build omits soft-launch mode, so indexing turns on
    // deliberately, never by accident.
    ...(IS_SOFT_LAUNCH ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical, ...(languages ? { languages } : {}) },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Medicine Passport by MediDocs",
      locale: OG_LOCALE[locale],
      ...(alternateLocale.length ? { alternateLocale } : {}),
    },
  };
}
