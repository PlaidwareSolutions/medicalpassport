import type { Metadata } from "next";
import { PUBLISHED_LOCALES, localePath, type MarketingLocale } from "./locales";

export const SITE_ORIGIN = "https://medidocs.app";

/**
 * Per-locale metadata (docs/landing-page/03 §7). hreflang alternates are
 * emitted only when more than one locale is published — a single-locale
 * alternates block is noise. OG imagery deliberately has no og:image yet:
 * the Session 4 ruling wants lockup + authentic product UI, which is produced
 * with the real media phase, not fabricated at foundation stage.
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
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical, ...(languages ? { languages } : {}) },
    openGraph: { title, description, url: canonical, siteName: "Medicine Passport by MediDocs" },
  };
}
