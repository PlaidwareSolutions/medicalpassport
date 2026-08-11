import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "../lib/seo";

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
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
