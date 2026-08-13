#!/usr/bin/env node
/**
 * Production launch preflight (Session 16, docs/landing-page/production-launch-runbook.md §Phase 4).
 *
 * Deterministic guard that catches the obvious dangerous production-cutover
 * mistakes BEFORE a production marketing build/deploy. It is intentionally NOT
 * a policy engine — just a fixed list of "this must be true for medidocs.app".
 *
 * Two modes (§18):
 *   - MARKETING_ENV=staging  → PERMISSIVE. Staging is allowed to use the staging
 *     host, staging Turnstile widget, staging Web-Analytics token, draft legal
 *     text and draft locales. Exits 0 so staging review is never broken.
 *   - otherwise (production) → STRICT. Requires real production config and
 *     cleared governance gates; exits 1 (NO-GO) if anything is wrong.
 *
 * Reads the same NEXT_PUBLIC_* env the build consumes, plus the source
 * constants and (when present) the emitted out/ tree — configuration is not
 * trusted without checking the artifact.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const MODE = process.env.MARKETING_ENV === "staging" ? "staging" : "production";

// Known staging / test values that must never appear in a production build.
const STAGING = {
  waToken: "3e2da44839cb46aaa28e6567ca8c3d4f",
  sitekey: "0x4AAAAAAENvjHC21DQmacb9",
  apiHost: "staging-api.medidocs.app",
  host: "staging.medidocs.app",
};
// Cloudflare Turnstile always-pass/always-block/force test keys (1x…/2x…/3x…).
const CF_TEST_SITEKEY = /^[123]x0{15,}/;
// Legal markers that must be resolved before production may serve /privacy /terms.
const LEGAL_MARKERS = [
  "DRAFT — LEGAL REVIEW REQUIRED",
  "LEGAL ENTITY TO BE CONFIRMED",
  "TO BE CONFIRMED",
  "NOT YET PROVISIONED",
  "COUNSEL REVIEW REQUIRED",
];

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

if (MODE === "staging") {
  console.log(
    "[check-launch] MODE=staging — staging config permitted (staging host/Turnstile/WA, draft legal, draft locales). No production assertions.",
  );
  process.exit(0);
}

// ── PRODUCTION MODE (strict) ─────────────────────────────────────────────────
const sitekey = process.env.NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY ?? "";
const apiUrl = process.env.NEXT_PUBLIC_LEAD_API_URL ?? "";
const waToken = process.env.NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN ?? "";

// Turnstile — must be a real production widget, never a test or the staging key.
check("turnstile.sitekey-set", sitekey.length > 0, "NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY must be the production sitekey");
check("turnstile.not-test-key", !CF_TEST_SITEKEY.test(sitekey), "must not be a Cloudflare TEST sitekey (1x…/2x…/3x…)");
check("turnstile.not-staging-key", sitekey !== STAGING.sitekey, "must not reuse the staging widget sitekey");

// API — production marketing must not point at the staging API.
check("api.url-set", apiUrl.length > 0, "NEXT_PUBLIC_LEAD_API_URL must be set");
check("api.not-staging", !apiUrl.includes(STAGING.apiHost), `must not point at ${STAGING.apiHost}`);
check("api.is-production", /^https:\/\/api\.medidocs\.app\//.test(apiUrl), "should target https://api.medidocs.app/…");

// Web Analytics — separate production token, never the staging one.
check("analytics.token-set", waToken.length > 0, "production Web Analytics token required");
check("analytics.not-staging", waToken !== STAGING.waToken, "must not reuse the staging Web-Analytics token");

// Canonical host — source constant must be the production apex, not staging.
const seo = readFileSync(join(root, "lib/seo.ts"), "utf8");
check("canonical.apex", /SITE_ORIGIN\s*=\s*"https:\/\/medidocs\.app"/.test(seo), "SITE_ORIGIN must be https://medidocs.app");
check("canonical.no-staging-ref", !seo.includes(STAGING.host), "seo.ts must not reference the staging host");

// Locales — production publication set must stay English-only until review.
const locales = readFileSync(join(root, "lib/locales.ts"), "utf8");
check(
  "locales.published-en-only",
  /PUBLISHED_LOCALES[^=]*=\s*\[\s*"en"\s*\]/.test(locales),
  "PUBLISHED_LOCALES must be [\"en\"] until hi/te/ur pass professional review",
);

// Emitted-output verification (defense in depth) — only if a build exists.
if (existsSync(out)) {
  const htmls = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith(".html")) htmls.push(p);
    }
  })(out);
  const leakMarkers = [STAGING.apiHost, STAGING.host, STAGING.waToken, STAGING.sitekey, "localhost"];
  const leaked = htmls.filter((p) => {
    const h = readFileSync(p, "utf8");
    return leakMarkers.some((m) => h.includes(m));
  });
  check("output.no-staging-leak", leaked.length === 0, `staging/localhost refs found in: ${leaked.map((p) => p.slice(out.length + 1)).join(", ")}`);
  const draftRoutes = ["hi", "te", "ur"].filter((l) => existsSync(join(out, l)));
  check("output.no-draft-locales", draftRoutes.length === 0, `unreviewed locale routes emitted: ${draftRoutes.join(", ")}`);

  // Legal gate — production must not serve draft/placeholder legal pages.
  for (const page of ["privacy/index.html", "terms/index.html"]) {
    const p = join(out, page);
    if (existsSync(p)) {
      const h = readFileSync(p, "utf8");
      const hit = LEGAL_MARKERS.find((m) => h.includes(m));
      check(`legal.${page.split("/")[0]}-cleared`, !hit, hit ? `still contains "${hit}"` : "");
    }
  }
} else {
  check("output.built", false, "no out/ — run the production `next build` before preflight");
}

// ── Report ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`[check-launch] MODE=production — ${results.length} checks, ${failed.length} failing\n`);
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : `  — ${r.detail}`}`);
if (failed.length) {
  console.error(`\n✖ production preflight: NO-GO (${failed.length} blocking). Resolve the ✗ items before cutover.`);
  process.exit(1);
}
console.log("\n✓ production preflight: config + governance gates satisfied.");
