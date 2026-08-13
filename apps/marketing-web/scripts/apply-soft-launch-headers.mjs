#!/usr/bin/env node
/**
 * Inject the controlled-soft-launch global noindex into the built `out/_headers`
 * (Session 19). The static `public/_headers` deliberately host-scopes noindex to
 * staging only, so the production apex is indexable by default — that is correct
 * for the FINAL public launch. During the soft launch we add apex + www scoped
 * `X-Robots-Tag: noindex` as the AUTHORITATIVE directive (not JS), paired with
 * the page-level robots meta (defence in depth, §10/§39).
 *
 * No-op unless MARKETING_RELEASE_MODE=soft-launch, so the final public-launch
 * build never carries it. Idempotent.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const headersPath = join(root, "out", "_headers");

if (process.env.MARKETING_RELEASE_MODE !== "soft-launch") {
  console.log("[apply-soft-launch-headers] not soft-launch — leaving _headers unchanged");
  process.exit(0);
}
if (!existsSync(headersPath)) {
  console.error("[apply-soft-launch-headers] out/_headers not found — run `next build` first");
  process.exit(1);
}

const MARKER = "# Controlled soft-launch noindex (Session 19)";
const BLOCK = `
${MARKER} — apex + www serve globally noindexed until the final public launch.
https://medidocs.app/*
  X-Robots-Tag: noindex, nofollow, noarchive
https://www.medidocs.app/*
  X-Robots-Tag: noindex, nofollow, noarchive
`;

const current = readFileSync(headersPath, "utf8");
if (current.includes(MARKER)) {
  console.log("[apply-soft-launch-headers] soft-launch noindex already present");
  process.exit(0);
}
writeFileSync(headersPath, current + "\n" + BLOCK);
console.log("[apply-soft-launch-headers] injected apex + www noindex into out/_headers");
