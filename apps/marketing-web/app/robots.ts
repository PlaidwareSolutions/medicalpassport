import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "../lib/seo";
import { IS_SOFT_LAUNCH } from "../lib/release-mode";

export const dynamic = "force-static";

/**
 * Staging indexing protection (Session 7 §0): builds made with
 * MARKETING_ENV=staging (the deploy:staging script and the CI staging job)
 * emit a disallow-all robots.txt and no sitemap reference. Production builds
 * (plain `next build`, no env) emit the normal production-oriented file —
 * noindex is therefore impossible to inherit at apex cutover, because the
 * production artifact is built without the flag. Belt-and-braces: a
 * staging-host-scoped X-Robots-Tag rule also lives in public/_headers.
 */
const IS_STAGING_BUILD = process.env.MARKETING_ENV === "staging";

export default function robots(): MetadataRoute.Robots {
  if (IS_STAGING_BUILD) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  // Controlled soft launch (Session 19): crawlable so a crawler can fetch the
  // page and SEE the global noindex directive (a Disallow would hide it), but
  // NO sitemap is advertised — the site is not being submitted for indexing
  // yet (§11/§12). Final public launch (below) restores the sitemap.
  if (IS_SOFT_LAUNCH) {
    return { rules: { userAgent: "*", allow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
