#!/usr/bin/env node
/**
 * Controlled production SOFT-LAUNCH preflight (Session 19).
 *
 * Unlike check-launch (the FINAL public-launch gate, which requires cleared
 * legal and would BLOCK today), this gate is for the deliberately-noindexed
 * soft launch on the real production apex. It therefore REQUIRES production
 * config AND requires that noindex is ON and the legal pages are still visibly
 * draft. It never lets the strict final-launch conditions be bypassed — the
 * final launch still needs build:production + check:legal to pass.
 *
 * Fails (exit 1) unless every check below holds. Run with
 * MARKETING_RELEASE_MODE=soft-launch after `next build` + prune +
 * apply-soft-launch-headers.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");

const STAGING = {
  waToken: "3e2da44839cb46aaa28e6567ca8c3d4f",
  sitekey: "0x4AAAAAAENvjHC21DQmacb9",
  apiHost: "staging-api.medidocs.app",
  host: "staging.medidocs.app",
};
const CF_TEST_SITEKEY = /^[123]x0{15,}/;
const LEGAL_DRAFT_MARKERS = ["DRAFT — LEGAL REVIEW REQUIRED", "LEGAL ENTITY TO BE CONFIRMED", "under legal review"];

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

check("mode.soft-launch", process.env.MARKETING_RELEASE_MODE === "soft-launch", "MARKETING_RELEASE_MODE must be 'soft-launch'");

const sitekey = process.env.NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY ?? "";
const apiUrl = process.env.NEXT_PUBLIC_LEAD_API_URL ?? "";
const waToken = process.env.NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN ?? "";

// Production config (same strict bar as the final launch).
check("turnstile.sitekey-set", sitekey.length > 0, "production Turnstile sitekey required");
check("turnstile.not-test-key", !CF_TEST_SITEKEY.test(sitekey), "must not be a Cloudflare TEST sitekey");
check("turnstile.not-staging-key", sitekey !== STAGING.sitekey, "must not reuse the staging widget");
check("api.is-production", /^https:\/\/api\.medidocs\.app\//.test(apiUrl), "NEXT_PUBLIC_LEAD_API_URL must be https://api.medidocs.app/…");
check("analytics.token-set", waToken.length > 0, "production Web Analytics token required");
check("analytics.not-staging", waToken !== STAGING.waToken, "must not reuse the staging Web-Analytics token");

// Canonical is domain-agnostic (env-driven for the rebrand): the emitted
// homepage must carry an https apex canonical that is not staging/localhost.
const homeForCanonical = existsSync(join(out, "index.html")) ? readFileSync(join(out, "index.html"), "utf8") : "";
const canonicalHref = homeForCanonical.match(/rel="canonical"\s+href="(https:\/\/[^"]+)"/)?.[1] ?? "";
check(
  "canonical.apex",
  /^https:\/\/[a-z0-9.-]+\/?$/.test(canonicalHref) && !canonicalHref.includes(STAGING.host) && !canonicalHref.includes("localhost"),
  `homepage canonical must be a production apex (got: ${canonicalHref || "none"})`,
);
const locales = readFileSync(join(root, "lib/locales.ts"), "utf8");
check("locales.published-en-only", /PUBLISHED_LOCALES[^=]*=\s*\[\s*"en"\s*\]/.test(locales), 'PUBLISHED_LOCALES must be ["en"]');

// Emitted artifact.
if (!existsSync(out)) {
  check("output.built", false, "no out/ — run the soft-launch build first");
} else {
  const htmls = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".html")) htmls.push(p);
    }
  })(out);
  const leakMarkers = [STAGING.apiHost, STAGING.host, STAGING.waToken, STAGING.sitekey, "localhost"];
  const leaked = htmls.filter((p) => leakMarkers.some((m) => readFileSync(p, "utf8").includes(m)));
  check("output.no-staging-leak", leaked.length === 0, `staging/localhost refs in: ${leaked.map((p) => p.slice(out.length + 1)).join(", ")}`);
  check("output.no-draft-locales", !["hi", "te", "ur"].some((l) => existsSync(join(out, l))), "unreviewed locale routes must not be emitted");

  // noindex ON (authoritative header + robots crawlable-no-sitemap + empty sitemap + meta).
  const headers = existsSync(join(out, "_headers")) ? readFileSync(join(out, "_headers"), "utf8") : "";
  check("noindex.apex-header", /https:\/\/medidocs\.app\/\*[\s\S]*?X-Robots-Tag:\s*noindex/.test(headers), "out/_headers must carry apex X-Robots-Tag noindex");
  const robots = existsSync(join(out, "robots.txt")) ? readFileSync(join(out, "robots.txt"), "utf8") : "";
  check("noindex.robots-crawlable", /Allow:\s*\/(?!\S)/.test(robots) && !/Disallow:\s*\//.test(robots), "robots.txt must Allow: / so the noindex is seen (§11)");
  check("noindex.no-sitemap-advertised", !/Sitemap:/i.test(robots), "robots.txt must NOT advertise a sitemap during soft launch (§12)");
  const sitemap = existsSync(join(out, "sitemap.xml")) ? readFileSync(join(out, "sitemap.xml"), "utf8") : "";
  check("noindex.sitemap-empty", !/<loc>/.test(sitemap), "sitemap.xml must be empty during soft launch (§12)");
  const home = existsSync(join(out, "index.html")) ? readFileSync(join(out, "index.html"), "utf8") : "";
  check("noindex.meta", /name="robots"[^>]*noindex/.test(home), "homepage must carry <meta robots noindex> (defence in depth, §10)");

  // Legal must REMAIN draft during soft launch (opposite of the final gate, §8).
  for (const page of ["privacy/index.html", "terms/index.html"]) {
    const p = join(out, page);
    const html = existsSync(p) ? readFileSync(p, "utf8") : "";
    check(`legal.${page.split("/")[0]}-still-draft`, LEGAL_DRAFT_MARKERS.some((m) => html.includes(m)), `${page} must still show draft/under-review status (soft launch does not clear legal)`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`[check-soft-launch] ${results.length} checks, ${failed.length} failing\n`);
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `  — ${r.detail}`}`);
if (failed.length) {
  console.error(`\n✖ soft-launch preflight: NOT READY (${failed.length} blocking).`);
  process.exit(1);
}
console.log("\n✓ soft-launch preflight: production config + noindex + draft-legal all satisfied.");
