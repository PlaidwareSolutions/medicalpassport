# Landing Page — Session 6: Cloudflare + Domain Foundation

**Date:** 2026-08-11 · **Status:** LIVE — staging deployed and verified; production apex untouched.
*(Unnumbered by convention: SPEC reserves 06/07 for the launch claim audit and post-launch report.)*

## What exists now

| Resource | Value |
|---|---|
| Worker | `medidocs-marketing-staging` — **assets-only** (no `main`, no runtime code), Cloudflare Workers Static Assets serving `apps/marketing-web/out` |
| Staging domain | `https://staging.medidocs.app` — Worker Custom Domain (Cloudflare-managed DNS + cert, min TLS per zone), attached automatically by `wrangler deploy` |
| Marketing bucket | `medidocs-marketing-assets` (R2, Standard class) |
| Assets domain | `https://assets.medidocs.app` — R2 custom domain bound to that bucket, min TLS 1.2; **`r2.dev` public access disabled** (verified) |
| Wrangler config | `apps/marketing-web/wrangler.toml` (repo-tracked; account `db356ac4…`, zone `medidocs.app` = `7bcd43cff5a24166bbf65b3ad8481ac6`) |
| Headers | `apps/marketing-web/public/_headers` → exported to `out/_headers`, consumed by Workers Static Assets |
| Deploy commands | `pnpm --filter @medpass/marketing-web deploy:staging` (build + deploy); CI job `deploy-marketing-staging` in `.github/workflows/ci.yml` |
| Verification object | `assets.medidocs.app/infra/healthcheck.txt` — deliberately harmless text created for this test; safe to delete |

**Production boundary honored:** `medidocs.app` and `www.medidocs.app` have **no DNS records and no configuration anywhere** — `wrangler.toml` defines only the staging worker/domain, so no invocation of this deploy path can touch the apex. Apex/www cutover remains an explicit later launch action (SPEC Sessions 16–17).

## PUBLIC MARKETING CONTENT ONLY — bucket security contract

`medidocs-marketing-assets` may contain **public marketing assets only**. It must NEVER contain: patient health information, prescriptions, patient documents, test reports, patient-linked medicine records, private application artifacts, authenticated-user content, backups, or logs with sensitive data. It is deliberately separate from every `medpass-*` application bucket; the application's buckets were not touched. Do not "temporarily" park anything private here — there is no private mode on this bucket's serving path.

## Credentials

- **Discovered, reused, sufficient:** a wrangler **OAuth session** (`wrangler login`, account `solutions@plaidware.com` / `db356ac4…`) was already present on this machine. No env-var tokens (`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`: absent), none in repo `.env` files.
- **Capabilities verified by doing:** Worker deploy ✓, Worker custom-domain attach ✓, R2 bucket create ✓, R2 custom-domain attach ✓, R2 object put ✓, zone lookup (read) ✓. Nothing was missing; nothing was requested from the owner; no token was created or rotated.
- **CI is a different credential**: the OAuth session is local-only. CI needs a repo secret **`CLOUDFLARE_API_TOKEN`** (not yet provisioned — the deploy job skips gracefully without it, so normal CI is unaffected). When minting, scope it least-privilege for: Account → Workers Scripts:Edit; Zone (`medidocs.app`) → Workers Routes:Edit; verify empirically whether custom-domain re-validation on deploy also needs Zone DNS:Edit, and add only if a real deploy fails without it. R2 permissions are NOT needed by CI (media publishing is a separate Session 9 pipeline with bucket-scoped Object R/W credentials).
- **Least-privilege note (follow-up, not done):** the local OAuth session is broader than this project needs (shared account). Fine for interactive use per owner instruction; do not embed it anywhere.

## Headers policy (repo-tracked, verified live)

- `/*`: `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy` (camera/mic/geo/payment/usb denied) · CSP `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` · `Cache-Control: public, max-age=0, must-revalidate`.
- **CSP honesty:** Next's static export ships inline bootstrap scripts and one inline style (verified in the real output), so `'unsafe-inline'` is required — there are no nonces/hashes and none are claimed. `'unsafe-eval'` absent; zero `eval(` in any chunk (verified). Documented future additions (added only when each ships): `assets.medidocs.app` (img/media), `challenges.cloudflare.com` (Turnstile), `static.cloudflareinsights.com` (Web Analytics).
- **Empirical `_headers` semantics:** Workers Static Assets **appends** matching rules; specific paths must detach with `! Cache-Control` before setting their own (caught live: an asset briefly served both cache values; fixed same session).
- Cache tiers verified live: HTML `max-age=0, must-revalidate` · `/_next/static/*` `max-age=31536000, immutable` · robots/sitemap 3600 · icon 86400.

## CI deployment path

`deploy-marketing-staging` job: push to `foundation` only → checks `CLOUDFLARE_API_TOKEN` presence (skips with a message if absent) → pnpm install → build marketing-web → **verifies `out/index.html` + `out/_headers` exist and greps the export for professional-unit content, failing the deploy if the gate leaked** → `wrangler deploy`. It does not gate on `build-test` (mirrors the Railway push-deploy convention). Production cannot deploy from CI: no production target exists in any config.

## Live verification results (2026-08-11, from public endpoints)

| Check | Result |
|---|---|
| `staging.medidocs.app` root | 200, valid TLS, all security headers present |
| `/privacy/` `/terms/` | 200 (stubs, noindexed, explicitly not policy) |
| `/robots.txt` `/sitemap.xml` | 200; sitemap contains exactly one URL (apex); no professional route, no locale routes |
| Unknown route | **404** via Next's 404.html (`not_found_handling = "404-page"` — no SPA-200 fallback) |
| `/for-clinics/` | 404; zero `for-clinics`/`c7-lead` strings in the deployed output |
| Redirects | none (0 redirects on root) |
| Browser (real Chromium, live) | 320px: 0px horizontal overflow; hydration works; sticky CTA appears on scroll (mobile). Desktop: page currently only 1148px tall (shell), so the hero sentinel never exits the viewport — sticky CTA correctly stays hidden until Session 7 content lengthens the page. Only console error: Cloudflare's **auto-injected Web Analytics beacon** (`static.cloudflareinsights.com`) correctly blocked by our CSP — see risks |
| `assets.medidocs.app/infra/healthcheck.txt` | 200, valid TLS, exact uploaded content (proves binding to the marketing bucket, not any application bucket) |
| Missing asset object | 404 (R2 object-not-found page) |
| `r2.dev` dev URL | disabled |
| Existing hostnames | `app`/`admin`/`staging-app`/`staging-admin` 200; `api`/`staging-api` root 404 by design with `api/healthz` → `{"status":"ok"}`; all valid TLS; untouched |
| Apex / www | still no DNS records; unreachable, as required |

## Rollback procedures (documented, not exercised)

- **Worker deploy:** `wrangler deployments list` in `apps/marketing-web`, then `wrangler rollback [version-id]` to restore the previous version (previous good: `d4e460f7…`, current: `d1843e67…`). Full teardown (only if ever needed): `wrangler delete` — removes worker + its custom domain; touches nothing else.
- **Staging domain only:** remove the `[[routes]]` block from `wrangler.toml` and redeploy (detaches `staging.medidocs.app`), or delete the custom domain in the Workers dashboard. The zone's other records are managed elsewhere and are not involved.
- **Assets domain only:** `wrangler r2 bucket domain remove medidocs-marketing-assets --domain assets.medidocs.app --zone-id 7bcd43cf…`. Bucket itself: `wrangler r2 bucket delete` only after emptying — never as routine rollback.
- Blast radius: all three procedures touch only `medidocs-marketing-*` resources; application workers/buckets/DNS are structurally out of scope of every command above.

## Deviations from Session 0 documentation + notes

1. Session 0 said "no Cloudflare config in-repo; no wrangler anywhere" — now superseded: `wrangler.toml` + `_headers` are repo-tracked, `wrangler 4.105.0` is a pinned devDependency of marketing-web (matches the locally-verified version; the only new dependency this session).
2. Session 0 flagged "a Cloudflare deploy token must be provisioned" — deferred: local OAuth sufficed for Session 6; the token is needed only when the CI secret is set.
3. `wrangler r2 object put` defaults to the **local simulator**; real uploads need `--remote` (caught when the healthcheck 404'd; the future Session 9 publisher must use the S3 API or `--remote`).
4. The zone has **Cloudflare Web Analytics auto-injection enabled account/zone-wide** (beacon injected into staging HTML). Our CSP blocks it today. Session 11 must decide deliberately: allow `static.cloudflareinsights.com` in CSP (it is the approved OD-LP-8 v1 mechanism) or disable auto-injection for this hostname and add it explicitly. Until then the block is correct behavior, not an error.

## Staging indexing protection (added Session 7 §0)

Staging is publicly reachable but pre-launch, so it must not be indexed. Two staging-specific layers, verified live: the `MARKETING_ENV=staging` build flavor (disallow-all `robots.txt`, empty `sitemap.xml` — used by `deploy:staging` and the CI job) and a **host-scoped** `_headers` rule (`https://staging.medidocs.app/*` → `X-Robots-Tag: noindex, nofollow, noarchive`). Production cannot inherit either: the apex never matches the host rule, and the production artifact is built without the env flag — **cutover requires no un-noindexing step**. Full-URL `_headers` matching confirmed working on Workers Static Assets this session.

## Unresolved infrastructure risks

- CI secret `CLOUDFLARE_API_TOKEN` unprovisioned → staging deploys are currently local-only (deliberate; owner provisions when ready).
- The beacon/CSP interaction above (Session 11 decision).
- Wrangler pinned at 4.105.0 while 4.120.x exists — upgrade deliberately, not incidentally.
