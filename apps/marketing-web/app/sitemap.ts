import type { MetadataRoute } from "next";
import { PUBLISHED_LOCALES, localePath } from "../lib/locales";
import { PROFESSIONAL_UNIT_ENABLED } from "../lib/release-flags";
import { SITE_ORIGIN } from "../lib/seo";
import { IS_SOFT_LAUNCH } from "../lib/release-mode";

export const dynamic = "force-static";

/**
 * Published locales only; legal placeholder stubs are noindexed and excluded
 * until Session 12 publishes reviewed text. The professional route joins only
 * with its release unit (OD-LP-10). Staging builds (MARKETING_ENV=staging)
 * emit an empty sitemap — while staging is globally noindexed there is no
 * reason to hand crawlers a useful URL list (Session 7 §0).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Staging and controlled soft launch both emit an empty sitemap — neither is
  // being submitted for indexing (§12). Final public launch restores the list.
  if (process.env.MARKETING_ENV === "staging" || IS_SOFT_LAUNCH) return [];
  const entries: MetadataRoute.Sitemap = PUBLISHED_LOCALES.map((locale) => ({
    url: `${SITE_ORIGIN}${localePath(locale)}/`,
  }));
  if (PROFESSIONAL_UNIT_ENABLED) {
    entries.push({ url: `${SITE_ORIGIN}/for-clinics/` });
  }
  return entries;
}
