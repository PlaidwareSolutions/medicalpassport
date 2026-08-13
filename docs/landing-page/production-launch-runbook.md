# Production Launch Runbook — medidocs.app (public marketing apex)

**Session 16 · 2026-08-13 · The exact, ordered, reversible procedure for Session 17.**

This is an operational runbook. **Nothing here is executed in Session 16** — Session 16 established engineering readiness and this plan. Session 17 executes it, and **only after every governance gate in [go-no-go.md](go-no-go.md) is GREEN**.

Conventions:
- `MANUAL CLOUDFLARE DASHBOARD ACTION` — no safe scripted path established; a human performs it in the Cloudflare dashboard.
- Secrets are never inline. `${LIKE_THIS}` is an environment-variable placeholder supplied through Railway/Cloudflare secret stores (§66 of the spec) — never committed, never printed.
- Every step has: **prerequisite · action · expected · verify · rollback**. A step missing any of these is not launch-ready.

---

## Guardrails (unchanged from Session 16)

Do NOT, until each is explicitly authorized: attach `medidocs.app`; configure `www`; provision production Turnstile; provision production Web Analytics; apply production API CORS; remove staging noindex; publish hi/te/ur; remove legal draft banners; choose/manufacture the legal entity.

The apex switch is **last** (§44): provision and test everything reachable without apex traffic first, then flip DNS.

---

## Target production serving architecture (§24)

| Host | Serves | Mechanism | Session-17 change? |
|---|---|---|---|
| `medidocs.app` (apex) | Production marketing (static export) | Cloudflare **Workers custom domain** on the marketing Worker | **NEW** — attach apex |
| `www.medidocs.app` | 301 → `https://medidocs.app` | Cloudflare **Redirect Rule** (or a bulk redirect); `www` as a proxied CNAME/AAAA placeholder to satisfy TLS | **NEW** — add redirect |
| `app.medidocs.app` | Patient PWA (Railway) | Existing custom domain | **none** |
| `api.medidocs.app` | API (Railway) | Existing custom domain | CORS origin add only (§22) |
| `admin.medidocs.app` | Admin (Railway) | Existing custom domain | **none** |
| `assets.medidocs.app` | Marketing R2 media | Existing R2 custom domain | **none** |

### Apex isolation proof (§25) — current DNS (read-only, 2026-08-13)
- `medidocs.app` → **no A/CNAME** (does not resolve). `www` → **no A/CNAME**.
- `app`/`api`/`admin`/`assets`/`staging*` → independent A records on Cloudflare-proxied IPs (`172.67.160.29`, `104.21.14.177`).
- Apex has **no MX / no TXT** today.

Because the apex is a **separate DNS record** and the marketing Worker is bound via a **Workers custom domain**, attaching `medidocs.app` cannot alter or displace the `app`/`api`/`admin`/`assets` records — those are distinct hostnames with their own routes. Confirmed no existing apex site to overwrite (§53): apex currently returns nothing.

### Email/DNS caution (§54)
The apex has no email records **today**, but OD-LP-7 provisioning (Google Workspace) will add **MX + SPF/DKIM/DMARC TXT** before or around launch. Session 17 must **add only** the records it needs (apex A/AAAA for the Worker + `www`). **Never "replace all DNS"** — an MX/TXT wipe would break email. Verify MX/TXT are intact immediately after any apex DNS change.

---

## Production configuration inventory (§19)

No secret values are printed. "Provisioned?" reflects state on 2026-08-13.

| Item | Env / source | Required | Intended production value/source | Provisioned? | Secret? | Launch blocker? |
|---|---|---|---|---|---|---|
| Marketing env | `MARKETING_ENV` | Yes | `production` (unset≠staging path) | build-time | No | No |
| Lead API origin | `NEXT_PUBLIC_LEAD_API_URL` | Yes | `https://api.medidocs.app/v1/public/leads` | value known | No | No |
| Assets origin | (in `published-media.json`) | Yes | `https://assets.medidocs.app` (first-party R2) | **Live** | No | No |
| Patient-app origin | `CtaLink.APP_CTA_URL` | Yes | `https://app.medidocs.app/?src=website` | **Live** | No | No |
| Canonical host | `lib/seo.ts SITE_ORIGIN` | Yes | `https://medidocs.app` (already hard-set) | **In code** | No | No |
| Turnstile sitekey | `NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY` | Yes | production widget public sitekey (§20) | **No** | No (public) | **YES** |
| Turnstile secret | API `LEAD_TURNSTILE_SECRET_KEY` | Yes | production widget secret (§20) | **No** | **Yes** | **YES** |
| Turnstile hostname | API `LEAD_TURNSTILE_HOSTNAMES` | Yes | `medidocs.app` | **No** | No | **YES** |
| Web-Analytics token | `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` | Yes | production WA site token (§21) | **No** | No (public) | No (analytics off-path) |
| Marketing→API CORS | API `CORS_ORIGINS` | Yes | add `https://medidocs.app` (§22) | Staged, **not applied** | No | **YES** (leads) |
| Cloudflare deploy | `wrangler` / CF API token | Yes | marketing Worker deploy credential (Session 6) | **Live (staging)** | **Yes** | No |
| Lead notify target | API `LEAD_NOTIFY_TO` (if used) | Optional | ops inbox (post OD-LP-7) | Pending | maybe | No |
| Public contact aliases | content/legal copy | Yes (for legal) | support@/privacy@/security@/partnerships@ | **No** (OD-LP-7) | No | **YES** (legal) |

---

## Phase 0 — Prerequisites (governance gate)
- **Prerequisite:** [go-no-go.md](go-no-go.md) shows **Governance GO** and **Production-Provisioning GO** ready to start.
- **Action:** none technical — confirm legal entity resolved, OD-LP-6 counsel sign-off recorded, OD-LP-7 mailboxes provisioned+tested, erasure operator named, English legal copy finalized (draft markers removable).
- **Expected/Verify:** `pnpm --filter @medpass/marketing-web check:legal` (production mode) exits 0; the legal pages no longer contain any marker in `LEGAL_MARKERS`.
- **Rollback:** if any gate is not GREEN, **stop** — do not proceed to Phase 1.

## Phase 1 — Provision production dependencies (§20, §21, OD-LP-7)
### 1a. Turnstile production widget (§20) — `MANUAL CLOUDFLARE DASHBOARD ACTION`
- **Action:** create widget `medidocs-marketing-leads-production`, hostname **`medidocs.app` only** (add `www.medidocs.app` only if `www` will serve the form; per §24 `www` only redirects, so apex-only). Do **not** reuse the staging widget or secret.
- **Result:** public **sitekey** → `NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY` (marketing build env); **secret** → API `LEAD_TURNSTILE_SECRET_KEY` (Railway prod secret); allowed hostname → API `LEAD_TURNSTILE_HOSTNAMES=medidocs.app`.
- **Verify:** sitekey is not a `1x…/2x…/3x…` test key and ≠ the staging sitekey (the preflight asserts this).
- **Rollback:** delete the widget; unset the env values.

### 1b. Web Analytics production site (§21) — `MANUAL CLOUDFLARE DASHBOARD ACTION`
- **Action:** create a **separate** Web Analytics site for `medidocs.app`; obtain its token → `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`. Install as the **manual JS snippet** (the app already renders `AnalyticsBeacon` from this token). Ensure **automatic zone-wide injection stays OFF** so analytics never lands on `app.`/`admin.`/share routes.
- **Verify:** token ≠ staging token; beacon appears only on marketing.
- **Rollback:** unset the token (beacon renders nothing; page unaffected).

### 1c. Mailboxes (OD-LP-7) — `MANUAL GOOGLE WORKSPACE ADMIN ACTION`
- **Action:** provision `support@ privacy@ security@ partnerships@medidocs.app`; add apex MX + SPF/DKIM/DMARC TXT.
- **Verify (§64):** for each address — inbound test delivered; primary `solutions@plaidware.com` receives; backup `kfnawaz@gmail.com`; reply works; **no bounce**. Only then may the addresses appear in published copy.
- **Rollback:** n/a (email provisioning is independent of the apex switch).

## Phase 2 — API production config (§22)
- **Prerequisite:** 1a done (Turnstile secret/hostname available).
- **Action:** on the **prod** API service (Railway, tracks `foundation`), set/confirm `CORS_ORIGINS` includes `https://medidocs.app`; set `LEAD_TURNSTILE_SECRET_KEY` and `LEAD_TURNSTILE_HOSTNAMES=medidocs.app`. `railway.prod.ts` already stages `CORS_ORIGINS="https://app.medidocs.app,https://admin.medidocs.app,https://medidocs.app"` — applying it is the deliberate act here. Do **not** add `*`.
- **Expected/Verify:** preflight from the apex origin returns the origin:
  ```
  curl -sI -X OPTIONS https://api.medidocs.app/v1/public/leads \
    -H "Origin: https://medidocs.app" -H "Access-Control-Request-Method: POST" \
    | grep -i access-control-allow-origin      # → https://medidocs.app
  ```
  (Today this returns no ACAO for the apex — correct, pre-launch.)
- **Rollback:** remove `https://medidocs.app` from `CORS_ORIGINS` (patient/admin origins unaffected → app keeps working).

## Phase 3 — Build production marketing
- **Prerequisite:** Phases 1–2; all production env values available in the build environment.
- **Action:**
  ```
  cd apps/marketing-web
  MARKETING_ENV=production \
  NEXT_PUBLIC_LEAD_API_URL=https://api.medidocs.app/v1/public/leads \
  NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY=${PROD_TURNSTILE_SITEKEY} \
  NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN=${PROD_WA_TOKEN} \
    pnpm build:production
  ```
- **Expected:** `check-locales` OK → `next build` → `prune-draft-locales` removes hi/te/ur → `check-legal` (0) → `check-claims` (pass) → `check-launch` (pass).
- **Verify:** `out/` contains `/`, `/for-clinics/`, `/privacy/`, `/terms/`; **no** `out/hi out/te out/ur`; `out/sitemap.xml` lists only apex English URLs; `out/robots.txt` = `Allow: /`.
- **Rollback:** discard `out/`; nothing deployed yet.

## Phase 4 — Preflight (§17)
- **Action:** `MARKETING_ENV=production … pnpm check:launch` (already chained by `build:production`).
- **Expected:** `✓ production preflight: config + governance gates satisfied.` (exit 0). Any `✗` is a hard stop.
- **Rollback:** fix the flagged item; rebuild.

## Phase 5 — Deploy marketing assets/Worker (no apex traffic yet)
- **Prerequisite:** Phase 4 green.
- **Action:** `wrangler deploy` the production marketing Worker **without** binding the apex custom domain yet (deploy to the `*.workers.dev` URL or a preview route). This lets Phase 9 smoke-test before public traffic.
- **Verify:** the Worker's non-apex URL serves the production `out/` (200, correct content, production headers). Turnstile widget renders; lead POST to `api.medidocs.app` works from that origin **once** its origin is CORS-allowed (may need a temporary allow, or smoke leads after Phase 6).
- **Rollback:** delete the Worker deployment; no public impact (apex not attached).

## Phase 6 — Attach apex (§24) — `MANUAL CLOUDFLARE DASHBOARD ACTION`
- **Prerequisite:** Phase 5 verified; MX/TXT recorded (Phase 1c) so they can be re-verified after.
- **Action:** bind `medidocs.app` as a **Workers custom domain** on the marketing Worker (Cloudflare provisions the edge cert). Add only the apex record required; **do not touch** app/api/admin/assets or MX/TXT.
- **Verify:** `dig medidocs.app` resolves; MX/TXT still present (§54).
- **Rollback:** **remove the apex custom-domain binding** → apex stops resolving to marketing within DNS/edge propagation; app/api/admin unaffected.

## Phase 7 — `www` redirect (§24) — `MANUAL CLOUDFLARE DASHBOARD ACTION`
- **Action:** add `www.medidocs.app` (proxied) + a Redirect Rule `www → https://medidocs.app` (301, preserve path).
- **Verify:** `curl -sI https://www.medidocs.app/for-clinics/` → `301` → `https://medidocs.app/for-clinics/`.
- **Rollback:** delete the redirect rule + `www` record.

## Phase 8 — DNS/TLS verification
- **Verify:** apex + www serve valid TLS (no cert warning); HSTS present; `curl -sI https://medidocs.app/` → `200` with production CSP.
- **Rollback:** if TLS invalid → Phase 6 rollback; investigate before re-attaching.

## Phase 9 — Functional smoke (§46 — run the full matrix below)
- **Prerequisite:** apex serving.
- **Action:** execute the **Production smoke matrix**.
- **Rollback:** any FAIL against a rollback-trigger (§48) → execute the mapped rollback.

## Phase 10 — SEO enablement (§45) — LAST, after smoke passes
- **Prerequisite:** apex serves correct content, TLS valid, **Privacy/Terms final** (no draft markers), canonical correct, professional form works, rollback available.
- **Action:** production build already emits `Allow: /` robots + sitemap; ensure no residual noindex on apex (staging noindex is host-scoped to `staging.medidocs.app` and never applied to apex). Confirm privacy/terms are indexable **only** once counsel-final.
- **Verify:** `curl https://medidocs.app/robots.txt` = Allow + sitemap; `sitemap.xml` = apex English URLs; homepage has no `noindex`.
- **Rollback:** redeploy a build with a temporary global noindex (a one-line `_headers`/robots change) if a serious content issue is found post-index.

## Phase 11 — Analytics validation (§46)
- **Verify:** exactly **one** production beacon on marketing pages; **zero** analytics requests on `app.`/`admin.`/`/s/` share routes.

## Phase 12 — Professional-lead human validation (§46)
- **Verify:** on `/for-clinics/`, a human solves the **real production** Turnstile, submits → `201`, lead persists (`professionalLead` row, `source=website-for-clinics`), field errors are safe; **no health data** accepted.

## Phase 13 — Final monitoring (§49)
- Watch per the Observability plan below (15 min / 1 h / 24 h).

---

## Production smoke matrix (§46)

| Area | Test | Pass criteria |
|---|---|---|
| Homepage | `GET /` | 200; `<title>` correct; hero media loads; CTA present; no console errors |
| Patient CTA | click "Create my free Medicine Passport" | → `app.medidocs.app/?src=website`; account flow unaffected |
| Professional | real Turnstile, human solve, submit | `201`; lead persisted; safe field errors; health-data rejected (strict schema) |
| Privacy/Terms | `GET /privacy/ /terms/` | approved content; **no draft markers**; indexable only when final |
| Sharing | `/s/<token>` on app | unaffected; `private, no-store` + `noindex` |
| Analytics | network trace | exactly one prod beacon on marketing; none on app/admin/share |
| Headers | `curl -sI` apex | CSP present; HSTS; **no `x-powered-by`** (already removed) |
| SEO | robots/sitemap/canonical | robots `Allow: /`; sitemap apex English only; canonical `https://medidocs.app/…` |

---

## Rollback (§47) — restore service fast without touching app/api/admin

The patient app, API, and admin are **independent hosts**; none depend on the marketing apex. Marketing rollback is a Cloudflare-only operation.

| Failure | Action | Notes / timing |
|---|---|---|
| Apex TLS failure | **Remove apex Workers custom-domain binding** (Phase 6 rollback) | apex stops serving; app/api/admin unaffected. Propagation = edge seconds–minutes; DNS TTL if a record was added. |
| Widespread 5xx from marketing | Re-deploy previous Worker version (`wrangler rollback`) or unbind apex | static export → 5xx is unlikely; unbinding is the fast kill-switch |
| Patient CTA broken | Fix `APP_CTA_URL`, redeploy Worker | CTA is a static link — no API/Turnstile dependency (§51) |
| Legal draft accidentally public | Unbind apex (kill-switch) or redeploy with noindex; **build:production would have blocked this** | legal guard is the primary prevention |
| Turnstile failure blocking leads | **DISABLE lead route** (see §50) — never fail Turnstile open | patient CTA still works |
| Analytics injected on app/admin | Turn OFF zone-wide auto-injection; unset token | beacon is token-gated |
| CSP breaks core UI | Redeploy previous `_headers` | test CSP in Phase 9 first |
| Serious claim mismatch | Unbind apex; fix copy; `check:claims` gate | |
| Secret exposure | Rotate the specific exposed secret; unbind if needed | Session-16 policy: rotate only on real exposure (§8) |

**Rollback timing is not instant** — Cloudflare edge changes take seconds-to-minutes; any newly-added DNS record is subject to its TTL. Unbinding the Worker custom domain is the fastest kill-switch.

## Rollback triggers (§48)
- Apex TLS invalid → **ROLLBACK** (unbind apex).
- Marketing 5xx > a few %/1 min → **ROLLBACK**.
- Patient CTA broken → **ROLLBACK** (blocks primary conversion).
- Legal draft public → **ROLLBACK** immediately.
- Turnstile unavailable / leads failing → **DISABLE lead feature** (§50), keep site up.
- Analytics on app/admin/share → **DISABLE analytics** (unset token / auto-inject off).
- CSP breaking core UI → **ROLLBACK** to prior headers.
- Claim mismatch / secret exposure → **ROLLBACK** + remediate.

## Lead-route degradation (§50, §51)
The lead form must **fail closed** on Turnstile (never accept unverified traffic). If Turnstile or the lead API/DB is unavailable: the form shows a bounded "temporarily unavailable, please email us" message (no insecure bypass; the API already returns `503` when the Turnstile secret is missing, and `turnstile_failed` otherwise). **Patient CTA is independent** (§51): "Create my free Medicine Passport" is a static link to `app.medidocs.app` with **no** dependency on Turnstile, the lead API, or Web Analytics — verified in code (`CtaLink.tsx`). Homepage also remains usable if `assets.medidocs.app` fails (§52): media sits in reserved aspect-ratio boxes (CLS 0), text/CTA never blocked — verified in Session 14 (all-media-blocked pass).

## Observability during launch (§49)
Use existing tooling only (no new platform):
- **First 15 min:** Cloudflare Worker request/error rate + TLS status; `curl` apex/www/privacy/terms; one human lead submission; confirm app/api/admin health endpoints still `200`/`ready`.
- **First 1 h:** Web Analytics pageviews arriving; Railway API logs (lead POSTs, error rate); no analytics on app/admin/share; spot-check CWV.
- **First 24 h:** lead volume vs. expectation (abuse?); Turnstile solve/fail ratio; any 5xx trend; backup cron ran (`cron-backup-export`).

---

## Operational runbooks referenced at launch

### Erasure (§63) — mechanism ready, operator OPEN
- **Mechanism:** `apps/api/src/ops/account-erasure.ts` + `erase-account.cli.ts` (plan/dry-run counts-only → execute). Tested against synthetic data.
- **SOP:** privacy request → **identity verified** → ticket assigned to **`OWNER REQUIRED` (named operator)** → dry-run (counts) → execute (revokes shares/sessions, erases eligible DB rows + private R2 objects, retains counts-only completion record) → notify → backups expire within ≤90-day window.
- **Do NOT execute in Session 16/17 launch.** Gate stays open until an operator is named.

### Mailboxes (§64)
See Phase 1c — all four addresses must pass inbound/primary/backup/reply/no-bounce before any address is published.

---

## Closed in Session 17 (engineering complete — no longer launch-time work)
- **Backup 90-day retention** — R2 lifecycle rule enforced + verified on prod; idempotent ensure-cron in IaC. (Was a Session-16 P1.)
- **Professional-lead 24-month retention** — `lastInteractionAt` migration + batched idempotent cleanup cron + tests. (Was a Session-16 P1.) The scheduled cron **service** is created on the next IaC apply.
- **Marketing → app `?lang=` handoff** — allowlisted, precedence-correct, dormant in prod; ready for when a locale is published.

There is **no** remaining "implement retention cron" or "add locale handoff" step in this runbook — those are done.

## Deferred (NOT English-launch blockers, §60)
Hindi/Telugu/Urdu professional review; `/for-clinics/` translation; Nastaliq; self-service deletion UI; Next 16 migration; new analytics; CRM. Governance items (legal entity, counsel, mailboxes, erasure operator) are owner-deferred until engineering is complete.
