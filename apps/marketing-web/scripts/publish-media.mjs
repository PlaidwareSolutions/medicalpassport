#!/usr/bin/env node
/**
 * Marketing media publisher (Session 9B, docs/landing-page/media-production.md).
 *
 * approved local candidate → sha256 content hash → hashed object key →
 * REMOTE upload to the dedicated public marketing bucket → public-URL
 * verification → apps/marketing-web/lib/published-media.json for the site.
 *
 * Structural invariants (deliberate, do not weaken):
 *  - BUCKET is a hardcoded exact identifier — never prefix-matched, never an
 *    application/patient bucket.
 *  - `--remote` is emitted by the script itself on every wrangler call; a
 *    caller cannot accidentally write to the local simulator (the Wrangler
 *    v4 trap found in Session 6).
 *  - Unknown MIME → hard fail. Missing file → hard fail. Post-upload public
 *    fetch must return 200 with the expected content-type, cache-control
 *    and byte length → otherwise hard fail.
 *  - Hashed objects get immutable cache metadata; nothing unhashed is ever
 *    marked immutable; existing published objects are never deleted here.
 *
 * PUBLIC MARKETING CONTENT ONLY — never patient data (bucket contract in
 * docs/landing-page/infrastructure.md).
 *
 * Usage: node scripts/publish-media.mjs [--dry-run]
 * Auth: reuses the local wrangler session (OAuth) — supervised publishing.
 * A future automated pipeline should use a bucket-scoped Object R/W token.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, extname, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BUCKET = "medidocs-marketing-assets";
const PUBLIC_ORIGIN = "https://assets.medidocs.app";
const MANIFEST = resolve(ROOT, "apps/patient-web/e2e-marketing/storyboard-manifest.json");
const OUT = resolve(ROOT, "apps/marketing-web/lib/published-media.json");
const DRY = process.argv.includes("--dry-run");

const MIME = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
};

const hash8 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);

function keyFor(kind, file, h) {
  const ext = extname(file);
  const base = basename(file, ext);
  if (kind === "video") return `video/en/${base}.${h}${ext}`;
  if (kind === "poster") return `images/posters/${base}.${h}${ext}`;
  if (kind === "og") return `images/og/${base}.${h}${ext}`;
  if (kind === "audio") return `audio/en/${base}.${h}${ext}`;
  throw new Error(`unknown asset kind: ${kind}`);
}

function put(key, file) {
  const mime = MIME[extname(file)];
  if (!mime) throw new Error(`unknown MIME for ${file} — refusing to publish`);
  if (!existsSync(file)) throw new Error(`missing file: ${file}`);
  const args = [
    "exec", "wrangler", "r2", "object", "put", `${BUCKET}/${key}`,
    "--file", file, "--content-type", mime,
    "--cache-control", "public, max-age=31536000, immutable",
    "--remote",
  ];
  if (DRY) {
    console.log("[dry-run] pnpm", args.join(" "));
    return;
  }
  execFileSync("pnpm", args, { stdio: "pipe", cwd: resolve(ROOT, "apps/marketing-web"), env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
}

async function verify(key, file) {
  if (DRY) return;
  const res = await fetch(`${PUBLIC_ORIGIN}/${key}`);
  const expectBytes = readFileSync(file).length;
  const ct = res.headers.get("content-type");
  const cc = res.headers.get("cache-control");
  const len = Number(res.headers.get("content-length") ?? (await res.arrayBuffer()).byteLength);
  if (res.status !== 200) throw new Error(`verify FAILED ${key}: HTTP ${res.status}`);
  if (ct !== MIME[extname(file)]) throw new Error(`verify FAILED ${key}: content-type ${ct}`);
  if (!cc?.includes("immutable")) throw new Error(`verify FAILED ${key}: cache-control ${cc}`);
  if (len !== expectBytes) throw new Error(`verify FAILED ${key}: ${len} bytes served, ${expectBytes} local`);
  console.log(`  ✓ ${PUBLIC_ORIGIN}/${key} (${expectBytes} bytes, ${ct})`);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

// Upload only APPROVED assets this run; PUBLISHED ones already live on R2 and
// keep their manifest `published` URLs. (Never rebuild the site's media map
// from just this run's uploads — that once dropped every already-published
// asset and blanked the homepage videos.)
for (const r of manifest.recordings) {
  const c = r.candidate;
  if (!c || c.status !== "APPROVED") {
    if (c) console.log(`skip ${r.id} (status ${c.status})`);
    continue;
  }
  console.log(`publishing ${r.id} …`);
  const uploaded = {};
  for (const [field, kind] of [["mp4", "video"], ["webm", "video"], ["poster", "poster"]]) {
    const file = resolve(ROOT, c[field]);
    const h = hash8(file);
    const key = keyFor(kind, file, h);
    put(key, file);
    await verify(key, file);
    uploaded[field] = `${PUBLIC_ORIGIN}/${key}`;
  }
  c.published = uploaded;
  c.status = "PUBLISHED";
}

for (const [name, kind] of [["og", "og"], ["audio", "audio"]]) {
  const x = manifest.candidateExtras?.[name];
  if (!x || x.status !== "APPROVED") {
    if (x) console.log(`skip extra ${name} (status ${x.status})`);
    continue;
  }
  const file = resolve(ROOT, x.file);
  const h = hash8(file);
  const key = keyFor(kind, file, h);
  put(key, file);
  await verify(key, file);
  x.published = { url: `${PUBLIC_ORIGIN}/${key}` };
  x.status = "PUBLISHED";
}

// The site media map is the SINGLE SOURCE OF TRUTH derived from every asset
// that has a `published` record in the manifest — this run's uploads plus all
// previously-published ones — so re-running never drops a live asset.
const published = { origin: PUBLIC_ORIGIN, publishedAt: new Date().toISOString(), assets: {} };
for (const r of manifest.recordings) {
  const c = r.candidate;
  if (!c?.published) continue;
  published.assets[r.id] = {
    landingSection: r.landingSection,
    transcript: c.transcript,
    durationSec: c.durationSec,
    dimensions: c.dimensions,
    mp4: { url: c.published.mp4 },
    webm: { url: c.published.webm },
    poster: { url: c.published.poster },
  };
}
for (const name of ["og", "audio"]) {
  const x = manifest.candidateExtras?.[name];
  if (!x?.published) continue;
  published.assets[name] = { url: x.published.url, ...(x.spokenText ? { spokenText: x.spokenText } : {}) };
}

if (!DRY) {
  writeFileSync(OUT, JSON.stringify(published, null, 2));
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`\nwrote ${OUT} (${Object.keys(published.assets).length} assets) and updated manifest statuses`);
}
