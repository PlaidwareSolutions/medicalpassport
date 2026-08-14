# Controlled Production Soft-Launch — Execution Report

**Session 19 · 2026-08-13.** Authorized action: cut over the production marketing infrastructure (`https://medidocs.app`) as a **controlled soft launch** (real infra, real apex, but global `noindex`, English-only, legal still draft), while governance continues in parallel.

## Status: **PRODUCTION SOFT LAUNCH LIVE** — `https://medidocs.app` reachable, noindexed, English-only

Live + verified 2026-08-14. Not the final indexed public launch (governance open; `build:production` + `check:legal` still BLOCK).

- ✅ Soft-launch **engineering** (mode + guard) — built, verified, committed.
- ✅ **Production Turnstile** widget + secret + hostname — owner-provisioned; sitekey `0x4AAAAAAEPalSkoCEktzz_r` baked into the live `/for-clinics/` bundle; widget renders; endpoint fail-closed.
- ✅ **Production Web Analytics** — existing `medidocs.app` site (JS snippet, auto-injection OFF); token `9bb7272d…` baked; **exactly one** beacon on marketing, **zero** on app/admin/share (no duplicate/auto-injection).
- ✅ **Production API CORS + retention crons** — applied + verified.
- ✅ **Production marketing Worker** `medidocs-marketing-production` deployed; **apex `medidocs.app` Custom Domain attached** (valid TLS, HTTP 200).
- ✅ **Global noindex** live (X-Robots-Tag header on every route + page meta + crawlable robots with no sitemap advertised + empty sitemap).
- ⏳ **`www.medidocs.app` → apex 301 redirect** — NOT configured (needs Cloudflare Zone/Ruleset edit; the deploy token has `zone:read` only). The **only** remaining cutover item; non-critical (apex is canonical and serves).

### Live smoke results (2026-08-14)
| Check | Result |
|---|---|
| Apex TLS + HTTP 200 | ✅ (`/ /for-clinics/ /privacy/ /terms/`) |
| `X-Robots-Tag: noindex` (all routes) + meta noindex | ✅ |
| robots.txt `Allow: /`, no sitemap; sitemap.xml empty | ✅ |
| Canonical `https://medidocs.app/`; no staging refs | ✅ |
| Locale gate — `/hi/ /te/ /ur/` → 404 | ✅ |
| Turnstile (prod sitekey) renders on `/for-clinics/` | ✅ |
| WA beacons: 1 on marketing / 0 on app / 0 on share | ✅ |
| Prod lead endpoint (apex origin) fail-closed (`turnstile_failed`); health-data strict-rejected | ✅ |
| Prod API CORS: apex allowed, evil denied, app/admin preserved | ✅ |
| Subdomains healthy (app/admin 200, api `postgres:ok`, assets 200); no `x-powered-by` | ✅ |
| Accessibility (axe) — 0 violations × 4 apex routes | ✅ |
| No staging/localhost/Google/Facebook/duplicate-analytics requests | ✅ |
| Final-launch gate `check:legal` still BLOCKS | ✅ |
| CTA → `app.medidocs.app/?src=website` | ✅ |

Deployed commit: `medidocs-marketing-production` version `bba57a40-e9b0-466c-94e5-8ab8c5deb092`. No secret was printed/committed.

## Railway production config — APPLIED (Session 19, verified)
`railway config apply --file .railway/railway.prod.ts` (clean plan: 2 add, 1 change, **0 destroy**):
- **API CORS** now authorizes `https://medidocs.app` (verified live: apex → ACAO; `app.medidocs.app` preserved; `evil.example` denied; `/readyz` `postgres:ok`).
- **`cron-cleanup-professional-leads`** created, schedule `0 5 * * *` (24-month lead retention — the Session-18 loose end, now **OPERATIONALLY SCHEDULED**).
- **`cron-ensure-backup-lifecycle`** created (self-heals the 90-day R2 rule; verified working via `railway run` — `alreadyCorrect: true`).
- **Cron secret fix (`preserve()`-on-new-service):** set `FIELD_ENCRYPTION_KEY` (both) + `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` (lifecycle) as **Railway reference variables** to `cron-backup-export` — no secret value handled/printed. Verified: `cleanup-professional-leads --dry-run` passes `loadEnv` (fails only on the internal DB, unreachable off-cluster); `ensure-backup-lifecycle` runs fully. A re-plan reports **"already up to date."**
- **IaC fix:** `railway.prod.ts` now declares `LEAD_TURNSTILE_SECRET_KEY: preserve()` + `LEAD_TURNSTILE_HOSTNAMES: preserve()` — without this, `apply` would have **deleted** the owner-provisioned production Turnstile secret + hostname (the original plan showed those two destroys; caught and fixed before applying).

- **RC frozen:** `medidocs-marketing-rc1` (`cc0db64`). Soft-launch mode added on top at `0f431a7` (this session; RC1 unmoved, §75).
- **Deployed:** nothing to production this session.

---

## Capability assessment (why provisioning is blocked)

The available Cloudflare credential (wrangler OAuth, `solutions@plaidware.com`, account `db356ac44b40bc2b194b6838d03eb84b`) has: `workers/workers_routes/workers_scripts/pages (write)`, `ssl_certs (write)`, `zone (READ)`, `account/user (read)`, `email_routing/email_sending (write)`. It does **NOT** have: **Turnstile edit**, **Web Analytics edit**, **Zone/DNS edit**, or **Rulesets/redirect edit**. No `CLOUDFLARE_API_TOKEN` is present in the environment.

Therefore these steps require a **MANUAL CLOUDFLARE DASHBOARD ACTION** (or a broader-scoped credential), per §18:
- create the production Turnstile widget;
- create the production Web Analytics site;
- attach the apex DNS / Workers Custom Domain (needs DNS edit);
- create the `www → apex` redirect rule.

Without the production Turnstile sitekey + Web-Analytics token, a valid soft-launch artifact **cannot be built** (`check:soft-launch` requires them), so the apex is not attached (correct order: provision before apex, §44).

---

## What WAS completed (engineering)

**Soft-launch release mode + guard** (`0f431a7`), verified:
- `MARKETING_RELEASE_MODE=soft-launch` (`lib/release-mode.ts`).
- `build:soft-launch` = check-locales → build → prune drafts → inject apex/www `X-Robots-Tag: noindex` into `out/_headers` → check-claims → `check:soft-launch`.
- `check:soft-launch` (18 checks, all pass with production env): production Turnstile (set/not-test/not-staging), production API origin, production WA token, apex canonical, en-only, no staging/localhost leak, no draft locales, **noindex ON** (apex header + crawlable robots + empty sitemap + page meta), and legal **still draft**.
- `robots.txt` soft-launch = `Allow: /` with **no sitemap advertised**; `sitemap.xml` empty (§11/§12).
- **Final-launch gate preserved:** `build:production` still BLOCKS on `check:legal` (14 markers) and stays indexable — **no soft-launch noindex leaks into it** (verified: 0 apex/www rules in the production `_headers`).
- Production Worker config `wrangler.production.toml` (`medidocs-marketing-production`, apex custom domain) — separate from staging (§31).

---

## Safety findings (important for whoever executes the Railway apply)

1. **`railway config plan` DEFAULTS to `.railway/railway.ts` (the DEV config).** Run against the prod-linked project it produced a **dangerous** plan: *move the production database region*, *set `api.OTP_DEV_FIXED_CODE` on prod*, and overwrite preserved prod secrets (CORS, Turnstile keys, R2 prefixes) with dev values — "2 add / 28 change / 1 destroy". **Always pass `--file .railway/railway.prod.ts` for prod.** The correct prod plan is clean: **"2 add, 1 change, 0 destroy"** — set `api.CORS_ORIGINS` (adds `medidocs.app`, preserves app/admin) + create `cron-cleanup-professional-leads` + `cron-ensure-backup-lifecycle`.
2. **`preserve()`-on-new-service footgun.** The two new cron services declare `FIELD_ENCRYPTION_KEY: preserve()` (required, `min(32)`) and, for `cron-ensure-backup-lifecycle`, `R2_ACCESS_KEY_ID/SECRET: preserve()`. On a **new** service `preserve()` resolves to **unset**, so the crons would **fail at `loadEnv`** until those secrets are set (copy from an existing cron service). Set them immediately after `config apply`.

Because of (2), the Railway apply was **not** performed this session — it would create broken crons that need secrets the agent must not manufacture.

---

## Exact remaining actions (operator runbook)

Follow [production-launch-runbook.md](production-launch-runbook.md) Phases 1–13. Concrete Session-19 specifics:

### 1. Production Turnstile — MANUAL CLOUDFLARE DASHBOARD ACTION
Create widget `medidocs-marketing-leads-production`, **Managed**, hostname **`medidocs.app` only** (not localhost/staging/app/www). Then:
- public **sitekey** → build env `NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY`;
- **secret** → Railway **prod api** `LEAD_TURNSTILE_SECRET_KEY` (server-only; never commit/log);
- `LEAD_TURNSTILE_HOSTNAMES=medidocs.app` on the prod api.

### 2. Production Web Analytics — MANUAL CLOUDFLARE DASHBOARD ACTION
Create a **separate** Web Analytics site for `medidocs.app`, **manual JS snippet** (keep automatic zone-wide injection **OFF**, §19/§20). Token → build env `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`.

### 3. Railway prod IaC — ✅ DONE (this session)
Applied `railway config apply --file .railway/railway.prod.ts`; CORS + both crons live and verified; cron secrets set via references; re-plan "up to date". (See "Railway production config — APPLIED" above.)

### 4. Build + deploy
`NEXT_PUBLIC_LEAD_API_URL=https://api.medidocs.app/v1/public/leads NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY=<prod> NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN=<prod> pnpm build:soft-launch` → then `wrangler deploy -c wrangler.production.toml`.

### 4. Build + deploy — ✅ DONE
`pnpm deploy:soft-launch` (bakes prod API + sitekey + WA token; runs guards; `wrangler deploy -c wrangler.production.toml`). The Workers Custom Domain attach worked with the deploy token (`workers_routes:write` + `ssl_certs:write` — Cloudflare manages the apex DNS internally).

### 5. Apex — ✅ DONE / www — ⏳ REMAINING (needs Zone/Ruleset edit)
Apex `medidocs.app` Custom Domain attached + verified live. **`www.medidocs.app` → `https://medidocs.app` 301 redirect is NOT configured** — it needs a Cloudflare **Redirect Rule** (Zone/Ruleset edit), which the deploy token lacks (`zone:read`). **MANUAL CLOUDFLARE DASHBOARD ACTION:** Rules → Redirect Rules → `www.medidocs.app/*` → 301 `https://medidocs.app/${path}` (preserve query); add a proxied `www` DNS record if needed. Non-critical for the soft launch (apex is canonical and serves). Do NOT serve a second copy of the site on `www` (§37).

### 6. Owner browser test — ⏳ (human Turnstile)
Do one happy-path lead submission on `https://medidocs.app/for-clinics/` (synthetic business info, no patient data): solve the production Turnstile → expect `201` + a persisted `ProfessionalLead` with `lastInteractionAt` initialized. The endpoint is confirmed **fail-closed** (no token → `turnstile_failed`); a real `201` requires a human solve.

### 6. Smoke + noindex verification
Run the runbook smoke matrix; confirm `X-Robots-Tag: noindex` on apex `/ /for-clinics/ /privacy/ /terms/`; robots crawlable-no-sitemap; exactly one WA beacon on marketing and **zero** on app/admin/share; do **not** enable indexing or submit a sitemap (§72).

---

## Final indexed launch — staged, one-step, still gated
Search indexing stays **OFF** (owner-confirmed). The eventual indexed launch is a single guarded command — `pnpm deploy:production` (indexable build: no soft-launch noindex, sitemap advertised + populated, en-only) → `wrangler deploy -c wrangler.production.toml` to the same already-attached apex. It **BLOCKS at `check:legal` (14 markers) + `check:launch`** and cannot reach `wrangler deploy` until governance closes (legal entity resolved + counsel-approved final Privacy/Terms with markers removed + mailboxes if referenced). Verified today: `deploy:production` halts at the legal gate; nothing deployed; live apex remains `X-Robots-Tag: noindex`. No `--force`, no marker edits, no guard weakening.

## Unchanged / verified this session
- **Backup 90-day R2 lifecycle:** re-verified intact (`expire-postgres-backups`, Enabled, multipart-abort preserved). Untouched.
- **Subdomains:** app/api/admin/assets/staging independent; prod API `postgres:ok`; no `x-powered-by`. Apex/www still unresolved (no external change since Session 16).
- **Staging** remains available (draft hi/te/ur review), §64.

## Governance — CONTINUING IN PARALLEL, DOES NOT INVALIDATE THE (pending) TECHNICAL CUTOVER
Legal entity · counsel (OD-LP-6) · governing law/venue · public mailboxes (OD-LP-7) · erasure operator · native-language review. **Final public/indexed launch: NOT YET AUTHORIZED.** `build:production` + `check:legal` remain the strict gate and still BLOCK.

## Rollback readiness
Marketing rollback stays Cloudflare-only (unbind the apex custom domain); app/api/admin/assets independent. Turnstile never fails open. See runbook Rollback + triggers.
