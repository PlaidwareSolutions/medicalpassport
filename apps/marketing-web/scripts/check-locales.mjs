#!/usr/bin/env node
/**
 * Marketing locale completeness / gate checker (Session 13 §40).
 *
 * Reads the dictionary sources and validates:
 *   - key parity vs. the English master (missing / extra / duplicate keys);
 *   - empty values;
 *   - stray placeholder markers (TODO/FIXME/XXX/[TRANSLATE]);
 *   - untranslated (English-fallback) coverage per draft locale (informational);
 *   - PUBLISHED locales must be complete — no missing keys, empties, or
 *     placeholders (fail the build); DRAFT locales are reported as warnings only,
 *     so an English production build is never blocked by unreviewed drafts.
 *
 * Note: the clinics and lead strings are intentionally English (English-only
 * /for-clinics/, §16) and are excluded from the fallback-coverage count.
 */
import { readFile } from "node:fs/promises";

const DIR = new URL("../lib/dictionaries/", import.meta.url).pathname;
const LOCALES = ["en", "hi", "te", "ur"];
const INTENTIONALLY_ENGLISH = /^(clinics\.|lead\.)/;

async function readPublishedLocales() {
  const src = await readFile(new URL("../lib/locales.ts", import.meta.url), "utf8");
  const m = src.match(/PUBLISHED_LOCALES[^=]*=\s*\[([^\]]*)\]/);
  return m ? [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]) : ["en"];
}

/** Extract { key: value } from a flat dictionary source (2-space-indented keys). */
async function parseDict(locale) {
  const src = await readFile(`${DIR}${locale}.ts`, "utf8");
  const entries = {};
  const dupes = [];
  const placeholders = [];
  // Keys are `  "key":` at the object's top indent. Values may span lines, so
  // capture from the key to the next top-level key (or close brace).
  const keyRe = /^ {2}"([\w.]+)":\s*([\s\S]*?)(?=^ {2}"[\w.]+":|^})/gm;
  let mm;
  while ((mm = keyRe.exec(src)) !== null) {
    const key = mm[1];
    const raw = mm[2].trim().replace(/,\s*$/, "");
    if (key in entries) dupes.push(key);
    // Join multi-line string concatenations into one logical value.
    const value = raw.replace(/^"/, "").replace(/"$/, "");
    entries[key] = value;
  }
  if (/TODO|FIXME|XXX|\[TRANSLATE/i.test(src)) {
    for (const line of src.split("\n")) {
      if (/"[\w.]+":.*(TODO|FIXME|XXX|\[TRANSLATE)/i.test(line)) placeholders.push(line.trim());
    }
  }
  return { entries, dupes, placeholders };
}

async function main() {
  const published = await readPublishedLocales();
  const dicts = {};
  for (const l of LOCALES) dicts[l] = await parseDict(l);
  const enKeys = Object.keys(dicts.en.entries);
  const enSet = new Set(enKeys);

  let failed = false;
  console.log(`\nLocale check — published: [${published.join(", ")}] · all: [${LOCALES.join(", ")}]\n`);

  for (const l of LOCALES) {
    const keys = Object.keys(dicts[l].entries);
    const set = new Set(keys);
    const missing = enKeys.filter((k) => !set.has(k));
    const extra = keys.filter((k) => !enSet.has(k));
    const empties = keys.filter((k) => dicts[l].entries[k] === "");
    const dupes = dicts[l].dupes;
    const placeholders = dicts[l].placeholders;
    const fallback =
      l === "en"
        ? []
        : keys.filter((k) => !INTENTIONALLY_ENGLISH.test(k) && dicts[l].entries[k] === dicts.en.entries[k]);
    const isPublished = published.includes(l);
    const translatable = keys.filter((k) => !INTENTIONALLY_ENGLISH.test(k)).length;
    const translated = translatable - fallback.length;

    console.log(`  ${l}${isPublished ? " (published)" : " (draft)"}: ${keys.length} keys` +
      (l === "en" ? "" : ` · translated ${translated}/${translatable} homepage strings`));
    const problems = [];
    if (missing.length) problems.push(`missing ${missing.length}: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`);
    if (extra.length) problems.push(`extra ${extra.length}: ${extra.slice(0, 5).join(", ")}`);
    if (dupes.length) problems.push(`DUPLICATE keys: ${dupes.join(", ")}`);
    if (empties.length) problems.push(`empty values: ${empties.join(", ")}`);
    if (placeholders.length) problems.push(`placeholder markers: ${placeholders.length}`);
    for (const p of problems) console.log(`     - ${p}`);

    // Gate: a PUBLISHED locale must be complete; any locale with a duplicate is a bug.
    const hardFail = dupes.length > 0 || (isPublished && (missing.length || empties.length || placeholders.length || extra.length));
    if (hardFail) failed = true;
    if (!isPublished && (missing.length || empties.length)) {
      console.log(`     (draft — not blocking the English build)`);
    }
  }

  if (failed) {
    console.error("\n[check-locales] FAIL — a published locale is incomplete or a duplicate key exists.\n");
    process.exit(1);
  }
  console.log("\n[check-locales] OK — published locales complete; draft coverage reported above.\n");
}

main().catch((e) => {
  console.error("[check-locales] error:", e);
  process.exit(1);
});
