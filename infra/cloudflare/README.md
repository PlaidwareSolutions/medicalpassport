# Cloudflare — what is actually configured

Rewritten 2026-09-06 (docs_v2 ticket 0.31). Cloudflare is the public edge (DNS, TLS, WAF, cache rules, Turnstile, Web Analytics) and private object storage (R2). No Cloudflare compute runs application logic (ADR-11); the marketing site is a static export served by a Worker.

## Zones and hostnames

| Host | Backs | Zone |
|---|---|---|
| `medicinepassport.app` | marketing (Worker `medicinepassport-marketing-production`) | medicinepassport.app |
| `app.medicinepassport.app` | patient-web (medpass-prod) | medicinepassport.app |
| `api.medicinepassport.app` | api (medpass-prod) — added 2026-09-01 to fix the cross-site cookie login loop | medicinepassport.app |
| `medidocs.app` | marketing (Worker `medidocs-marketing-production`) | medidocs.app |
| `app.` / `api.` / `admin.medidocs.app` | medpass-prod | medidocs.app |
| `staging-app.` / `staging-api.` / `staging-admin.medidocs.app`, `staging.medidocs.app` | medpass-dev / marketing staging Worker | medidocs.app |
| `assets.medidocs.app` | R2 bucket `medidocs-marketing-assets` | medidocs.app |

Open cutover items (docs_v2 tickets 0.5/0.6): `www` records and 301s on both apexes; phase-3 `medidocs.app → medicinepassport.app` redirect; moving `admin.`/`assets.` to the new apex; replicating the rules below onto the `medicinepassport.app` zone (rules are per-zone and exist only on `medidocs.app` today).

## TLS and headers

All records proxied; SSL **Full (strict)**; minimum TLS 1.2; HSTS on (6 months, includeSubDomains, nosniff) — not preload-listed. The API now repeats a defensive header set at origin (`apps/api/src/common/security-headers.ts`).

## WAF, rate limiting, cache

Free plan → managed WAF ruleset plus **exactly one** custom rate-limit rule (10 s window): OTP request, 2 req / 10 s / IP, covering staging and production api hostnames. Every other flow relies on the application limiter (`RateLimitBucket`, Postgres). Cache rules: bypass on api/admin hostnames; cache-everything on `/_next/static/*`. Plan upgrade to Pro is a cost decision (docs_v2/16 R10).

## R2

11 buckets: `medpass-dev-{patient-docs,derived,ocr-tmp,backups,public-assets}`, `medpass-prod-{same}`, `medidocs-marketing-assets`. `ocr-tmp` 48 h lifecycle; `backups` 90-day lifecycle (self-healed nightly by `cron-ensure-backup-lifecycle`). Bucket isolation dev↔prod is real; **credential isolation is not** (one R2 key pair for both — ticket 0.3). No public URLs to patient data, ever; access via presigned URLs from the API only.

## Turnstile and analytics

Patient/admin login widgets: staging `0x4AAAAAAD6vGglnBMbvP_EJ`, production `0x4AAAAAAD7CYz9zDT2RqibR` (hostnames include `app.medicinepassport.app`). Marketing lead widgets: staging `0x4AAAAAAENvjHC21DQmacb9`, production `0x4AAAAAAEPalSkoCEktzz_r`. Server-side verification fails closed. Web Analytics: manual beacon, marketing only; no analytics in the patient app.

## Tokens

The deploy token in use has `zone:read` only, which is why the `www`/301 items are still open; a token with ruleset/DNS edit rights is ticket 0.3.
