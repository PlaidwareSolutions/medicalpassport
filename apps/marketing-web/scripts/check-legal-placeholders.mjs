#!/usr/bin/env node
/**
 * Launch-safety guard (Session 12, SPEC §57).
 *
 * A PRODUCTION marketing build must never publish a legal page that still
 * contains unresolved review placeholders. This scans the static export
 * (`out/`) for known markers and fails the build if any are found.
 *
 * It deliberately does NOT run against staging review builds: staging is where
 * the drafts live and must keep their DRAFT banner + reviewer placeholders. So
 * when MARKETING_ENV=staging, this is a no-op success.
 *
 * This is a last-resort safety net, not a substitute for human legal review.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = new URL("../out/", import.meta.url).pathname;

// Distinctive markers that must never reach production. Kept in sync with the
// draft legal pages + LegalPage.tsx and the governance docs' placeholder style.
const MARKERS = [
  "LEGAL REVIEW REQUIRED",
  "TO BE CONFIRMED",
  "NOT YET PROVISIONED",
  "OWNER REQUIRED",
  "COUNSEL REVIEW REQUIRED",
];

const env = process.env.MARKETING_ENV ?? "";

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // no out/ yet — nothing to scan
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.(html|txt)$/.test(e.name)) yield full;
  }
}

async function main() {
  if (env === "staging") {
    console.log("[check-legal-placeholders] staging build — draft placeholders allowed, skipping.");
    return;
  }

  const hits = [];
  for await (const file of walk(OUT_DIR)) {
    const body = await readFile(file, "utf8");
    for (const m of MARKERS) {
      if (body.includes(m)) hits.push({ file: file.replace(OUT_DIR, ""), marker: m });
    }
  }

  if (hits.length > 0) {
    console.error(
      `\n[check-legal-placeholders] BLOCKED: production build (MARKETING_ENV="${env || "<unset>"}") ` +
        `contains ${hits.length} unresolved legal placeholder(s):`,
    );
    for (const h of hits) console.error(`  - ${h.file}: "${h.marker}"`);
    console.error(
      "\nLegal pages are still drafts. Resolve placeholders and obtain OD-LP-6 legal sign-off " +
        "before a production build. (Staging builds set MARKETING_ENV=staging and are exempt.)\n",
    );
    process.exit(1);
  }

  console.log("[check-legal-placeholders] OK — no unresolved legal placeholders in production build.");
}

main().catch((err) => {
  console.error("[check-legal-placeholders] error:", err);
  process.exit(1);
});
