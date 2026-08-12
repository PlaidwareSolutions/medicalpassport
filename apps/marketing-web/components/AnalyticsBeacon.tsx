import { ANALYTICS_TOKEN } from "../lib/analytics";

/**
 * Cloudflare Web Analytics — deliberate, manual beacon (OD-LP-8).
 *
 * Rendered ONLY on the marketing site, ONLY when a token is configured
 * (`NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`). It is the official Cloudflare
 * snippet (aggregate pageviews + Core Web Vitals only — no custom events, no
 * cookies, no patient/lead data). When the token is unset (today, until a
 * Web-Analytics-scoped credential provisions a staging site and disables the
 * zone's automatic injection), this renders nothing and the page behaves
 * identically — analytics is never on the critical path.
 *
 * Never mounted in patient-web, never on `/s/<token>` share pages (§32/§33).
 */
export function AnalyticsBeacon() {
  if (!ANALYTICS_TOKEN) return null;
  return (
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token: ANALYTICS_TOKEN })}
    />
  );
}
