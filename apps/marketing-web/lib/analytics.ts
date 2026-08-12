/**
 * Cloudflare Web Analytics token (public site token, not a secret). Baked at
 * build time. Empty until a Web-Analytics-scoped Cloudflare credential
 * provisions a dedicated staging site and its automatic zone injection is
 * turned off — see docs/landing-page/analytics-and-attribution.md. When empty,
 * the beacon renders nothing (analytics stays off, page unaffected).
 *
 * Staging and production get SEPARATE tokens (§19); the staging build sets
 * NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN to the staging site's token only.
 */
export const ANALYTICS_TOKEN = process.env.NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN ?? "";
