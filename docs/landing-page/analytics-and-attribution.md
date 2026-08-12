# Landing Page — Session 11: Analytics, Attribution & Turnstile

**Date:** 2026-08-12 · **Status:** code complete + deployed to staging; some live activation blocked on Cloudflare credential scope (below). Production apex untouched.

Implements OD-LP-8's V1 model and closes the two Session-10 items (Turnstile, share-display). **No general analytics platform, no third-party trackers, no Workers Analytics Engine, no custom-event pipeline.**

## Credential constraint (read first)

The Cloudflare access available this session (the Session-6 wrangler OAuth) has **no Turnstile scope and no Web Analytics scope** (both API calls return auth errors), and no separate Cloudflare API token is present. So this session could **not**: create a real Turnstile widget, create a Web Analytics site/token, or disable the zone's automatic beacon injection. Everything is built to activate the moment those are provisioned; the exact blocked steps are called out below.

## A. Turnstile (professional lead form)

**Code — complete and tested.** The lead endpoint is now **fail-closed**: in `production`/`staging` a missing `LEAD_TURNSTILE_SECRET_KEY` makes `POST /v1/public/leads` return `503` rather than silently accepting bot traffic (§7); local/test may run without it. Server-side `verifyTurnstile` calls Cloudflare Siteverify and, as defense-in-depth, validates the returned `hostname` against `LEAD_TURNSTILE_HOSTNAMES` when set (skipped when the response carries none, e.g. test keys). The client resets the single-use widget after any failed submit so retries get a fresh token. Turnstile loads **only** on `/for-clinics/`, never the patient homepage (§34).

**Staging live — test keys.** Because a real widget can't be provisioned (no scope), staging uses Cloudflare's **public test keys** to prove the full path end-to-end (widget → token → Siteverify → accept): sitekey `1x00000000000000000000AA` (build env `NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY`), secret `1x0000000000000000000000000000000AA` (set on the medpass-dev `api` service as `LEAD_TURNSTILE_SECRET_KEY`, value never committed). These always-pass — they verify plumbing, not real bot-blocking.

**Remaining (blocked on a Turnstile-scoped Cloudflare token / dashboard):** create `medidocs-marketing-leads-staging` (domains: `staging.medidocs.app`) and `-production` (domains: `medidocs.app`) widgets — authorizing **only** those hostnames, never `app./api./admin.`; swap the test sitekey/secret for the real ones; set `LEAD_TURNSTILE_HOSTNAMES=staging.medidocs.app` (then `medidocs.app`) to turn on hostname enforcement. Managed mode. Production widget stays uncreated until launch.

Variable names (values never here): `LEAD_TURNSTILE_SECRET_KEY` (api, secret), `LEAD_TURNSTILE_HOSTNAMES` (api), `NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY` (marketing build, public).

## B. Share-recipient schedule display

Root cause: `visit-summary.service.ts` built `instructionSummary` as `"<dose> · <frequencyCode> · <food>"`, so a pattern-scheduled medicine read `"1 tablet · PATTERN 1-0-1 · after"`. Fix: when a `pattern` exists, show it directly (`"1 tablet · 1-0-1 · after"`); standard codes (OD/BD/…) stay as clinical shorthand. One change covers the JSON share view **and** the PDF (the worker renders the same string). Regression test added (asserts `1-0-1`, never `PATTERN`). **Sharing media:** the Session-10 R7 clip showed the defect, so R7 was re-recorded against the fixed stack (recipient now shows `1-0-0`/`1-0-1`), re-encoded, and republished with a new content hash (`share-doctor-en.53fb42b6.mp4`, etc.); the old immutable hash stays in R2. Frame-verified clean — no `PATTERN`, and the QR/localhost frame still excluded.

## C. Cloudflare Web Analytics

**Approved role only:** aggregate marketing-site traffic + Core Web Vitals. No custom events, no CTA/form events, no manual beacon POSTs.

**Built:** a deliberate, manual beacon component (`components/AnalyticsBeacon.tsx`) that renders the official Cloudflare snippet **only** on marketing-web and **only** when `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` is set. It is **dormant** today (no token) — renders nothing, page unaffected. Never in patient-web, never on `/s/<token>` share pages (§32/§33).

**Not enabled live (blocked on scope).** The zone currently auto-injects a beacon that CSP **blocks** (Cloudflare adds it; `script-src`/`connect-src` deliberately exclude `cloudflareinsights`). Per §17/§18 I did **not** add those CSP origins, because doing so would enable that *uncontrolled* auto-injected beacon. Activation (all needing a Web-Analytics-scoped credential / dashboard): (1) create a **staging** Web Analytics site for `staging.medidocs.app` and a separate **production** site for `medidocs.app` (§19); (2) **disable automatic injection** for the marketing hostname so only the manual snippet runs; (3) set `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` (staging token) in the build; (4) add exactly `https://static.cloudflareinsights.com` to `script-src` and `https://cloudflareinsights.com` to `connect-src` in `public/_headers`. No wildcards.

## D. First-party acquisition attribution

**Contract (§24):** only the controlled value `website` is recognised. `normalizeAcquisitionSource()` maps anything else to `null` — never a free string, referrer, UTM, phone, or health data.

**Flow:** the marketing CTA sends `app.medidocs.app/?src=website`; patient-web captures `?src` on first load (`lib/acquisition.ts`, in the app-wide `InstallPromptListener`) into `localStorage`, **first-touch** (never overwrites an existing value), and sends it with OTP verify. The API persists it **once, at account creation only** (`User.acquisitionSource`, migration `20260812060048_user_acquisition_source`) — a returning patient can never overwrite or backfill it. No account is created just from opening the URL; attribution lands at successful identity establishment (§26).

**Semantics verified by tests:** `website` persisted at first sign-in; unknown ignored → null; no source → null; first-touch (revisit doesn't overwrite, later source doesn't backfill).

## E. Funnel — what's now measurable

| Stage | Source | Measurable? |
|---|---|---|
| Marketing traffic | Cloudflare Web Analytics | **After** analytics activation (blocked on scope) |
| Website-attributed accounts | `User.acquisitionSource = 'website'` count | **Yes** |
| …new in window | same, `createdAt` window | **Yes** |
| Activation (≥1 medicine) | website accounts owning a profile with ≥1 medication | **Yes** |
| Professional leads / last 24h | `ProfessionalLead` rows | **Yes** (Session 10) |

Intentionally omitted: per-page clickstream, CTA-hover/section events, a precise signup-vs-account intermediate step (no noisy event infra for a perfect 4-step funnel, §27). All surfaced as **aggregate counts** in the daily `operational-report` (`websiteAttributedAccounts`, `…Last24h`, `…Activated`, plus the lead counts) — no patient identity, no medicine content.

## F. Privacy boundary (§31)

- **Cloudflare Web Analytics** receives only the service's standard browser/performance signals — no custom data, and it's dormant until activated.
- **First-party product data** holds `acquisitionSource = website` (or null) on the user — nothing else marketing-related.
- **Lead system** holds professional business-contact fields.
- **No marketing analytics system ever receives** medicine names, diagnoses, prescriptions, reports, glucose, allergies, caregiver health data, or lead email/phone/message. Lead fields never go to analytics, URLs, or logs; the ops report logs only aggregate counts.

## G. Rollback / disable

- Analytics: unset `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` → beacon renders nothing.
- Turnstile: it's fail-closed by design; to intentionally disable lead collection, that's a product decision, not an env toggle. The test keys can be swapped/removed on the medpass-dev api service.
- Attribution: the `User.acquisitionSource` column is additive and nullable; ignoring it is harmless.
