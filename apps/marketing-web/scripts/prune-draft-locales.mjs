#!/usr/bin/env node
/**
 * Prune unpublished locale routes from a PRODUCTION export (Session 16).
 *
 * `output: export` cannot emit a dynamic route ([locale]) with zero static
 * params, so generateStaticParams always lists the architectural non-English
 * locales (lib/locales.ts localeStaticParams). In a production build those
 * unpublished locales render as notFound() 404 stubs; this removes their
 * directories so the shipped artifact is strictly the approved
 * PUBLISHED_LOCALES set (English only, until hi/te/ur pass review — §14/§37).
 *
 * No-op in staging (MARKETING_ENV=staging), where the draft locale routes are
 * intentional for reviewers. The production preflight (check-launch.mjs) also
 * asserts no draft locale routes remain, as a backstop.
 */
import { rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out");

if (process.env.MARKETING_ENV === "staging") {
  console.log("[prune-draft-locales] staging build — draft locale routes kept for review");
  process.exit(0);
}

// Architectural non-English locales (MARKETING_LOCALES minus en). Anything here
// that is not in PUBLISHED_LOCALES must not appear in a production artifact.
const DRAFT_LOCALES = ["hi", "te", "ur"];
const removed = [];
for (const l of DRAFT_LOCALES) {
  const dir = join(out, l);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    removed.push(l);
  }
}
console.log(
  removed.length
    ? `[prune-draft-locales] removed unpublished locale routes from out/: ${removed.join(", ")}`
    : "[prune-draft-locales] no draft locale routes present",
);
