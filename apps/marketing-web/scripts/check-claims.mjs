#!/usr/bin/env node
/**
 * Claim-integrity regression guard (Session 15, docs/landing-page/security-claims-audit.md).
 *
 * Runs against the built static export (`out/`) after `next build`. It codifies
 * the truth-first invariants the Session-15 audit verified, so a later copy or
 * gate edit cannot silently regress them:
 *
 *  1. The negative-capability disclaimers stay present on the homepage
 *     (does-not-diagnose / does-not-check-interactions / does-not-declare-safe).
 *  2. The app-vs-website language honesty clause stays present (the website is
 *     English; the app is multilingual) — the distinction must not vanish.
 *  3. Legal pages keep the DRAFT marker (unapproved policy is never presented
 *     as final).
 *  4. No source maps are emitted (a security regression, not a claim one, but
 *     cheap to assert here).
 *  5. Content gates that must stay OFF until formal approval are still `false`
 *     in source (a flip is a deliberate act and should fail this guard until
 *     the approval + wording land together).
 *
 * Non-blocking philosophy: it asserts POSITIVE invariants against emitted HTML
 * (robust, no false positives). Exit 1 on any violation so it can gate deploy
 * alongside check-locales / check-legal.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");
const failures = [];

function read(rel) {
  const p = join(out, rel);
  if (!existsSync(p)) {
    failures.push(`missing built page: ${rel} (run \`next build\` first)`);
    return "";
  }
  return readFileSync(p, "utf8");
}

// 1 + 2 — homepage invariants (negative capability + language honesty).
const home = read("index.html");
const homeMustContain = [
  ["does not check drug interactions", "FAQ interaction disclaimer (faq.a6)"],
  ["does not declare any medicine", "‘not safe’ disclaimer (trust.not_4)"],
  ["does not diagnose or prescribe", "diagnose/prescribe disclaimer (trust.not_1)"],
  ["This website is currently in English", "app-vs-website language honesty (faq.a3)"],
];
for (const [needle, label] of homeMustContain) {
  if (home && !home.includes(needle)) failures.push(`homepage missing ${label}: "${needle}"`);
}

// 3 — legal pages must carry the draft marker.
for (const page of ["privacy/index.html", "terms/index.html"]) {
  const html = read(page);
  if (html && !html.includes("DRAFT — LEGAL REVIEW REQUIRED")) {
    failures.push(`${page} is missing the DRAFT — LEGAL REVIEW REQUIRED marker`);
  }
}

// 4 — no source maps in the shipped artifact.
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".map")) failures.push(`source map emitted: ${p.slice(out.length + 1)}`);
  }
}
if (existsSync(out)) walk(out);

// 5 — gates that must stay OFF until formal approval.
const gates = readFileSync(join(root, "lib/content-gates.ts"), "utf8");
for (const flag of ["CLINICAL_CLAIMS_APPROVED", "NEVER_SOLD_CHIP_APPROVED"]) {
  if (!new RegExp(`export const ${flag} = false`).test(gates)) {
    failures.push(`${flag} is no longer \`false\` — a gated claim may be live without recorded approval (see security-claims-audit.md CLM-2/CLM-3)`);
  }
}

if (failures.length) {
  console.error("✖ claim-integrity check FAILED:");
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log("✓ claim-integrity check passed (negative-capability, language honesty, legal drafts, no source maps, gates OFF)");
