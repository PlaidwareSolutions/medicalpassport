# Landing Page — Session 11: Analytics, Attribution & Turnstile

**Date:** 2026-08-12 · **Status:** code complete + deployed to staging. **Live activation done** for real Turnstile and the manual Web Analytics beacon (verified below). One residual dashboard item remains (disable the pre-existing `medidocs.app` automatic beacon so staging isn't double-counted). Production apex untouched.

Implements OD-LP-8's V1 model and closes the two Session-10 items (Turnstile, share-display). **No general analytics platform, no third-party trackers, no Workers Analytics Engine, no custom-event pipeline.**

## Credential note

Activation used a **scoped Cloudflare API token** (`medpass-marketing-turnstile-analytics`, permission **Account → Turnstile → Edit** only) to create the real Turnstile widget, plus a **dashboard-created Web Analytics site** for `staging.medidocs.app` (its public site token). Cloudflare exposes **no API-token Edit permission for Web Analytics** (Account Analytics is Read-only), so site creation and automatic-injection settings are dashboard-only. The Turnstile API token is a secret — never committed, stored session-private and used inline. Sitekey and Web-Analytics site token are public (baked into the build).

## A. Turnstile (professional lead form)

**Code — complete and tested.** The lead endpoint is now **fail-closed**: in `production`/`staging` a missing `LEAD_TURNSTILE_SECRET_KEY` makes `POST /v1/public/leads` return `503` rather than silently accepting bot traffic (§7); local/test may run without it. Server-side `verifyTurnstile` calls Cloudflare Siteverify and, as defense-in-depth, validates the returned `hostname` against `LEAD_TURNSTILE_HOSTNAMES` when set (skipped when the response carries none, e.g. test keys). The client resets the single-use widget after any failed submit so retries get a fresh token. Turnstile loads **only** on `/for-clinics/`, never the patient homepage (§34).

**Staging live — REAL widget (test keys removed).** The real `medidocs-marketing-leads-staging` widget is created and enforcing: **managed** mode, authorizing **only** `staging.medidocs.app` + `localhost` (never `app./api./admin.`). Public sitekey `0x4AAAAAAENvjHC21DQmacb9` is baked into the marketing build (`NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY`, verified in the deployed for-clinics JS chunk); the widget secret is set on the medpass-dev `api` service as `LEAD_TURNSTILE_SECRET_KEY` (value never committed), and `LEAD_TURNSTILE_HOSTNAMES=staging.medidocs.app` turns on hostname enforcement.

**Live verification (2026-08-12):**
- Real widget renders on `/for-clinics/` — a live `challenges.cloudflare.com` challenge frame loads (managed-mode, ~13 sub-requests). No CSP violations.
- **Real secret proven enforcing, not the always-pass test secret:** a POST to `/v1/public/leads` with a *bogus* `turnstileToken` now returns **400 `turnstile_failed`** (the test secret would have accepted it → 201). Token-less POST also 400 (fail-closed). This is the decisive discriminator that Siteverify is running against the real widget secret.
- **Happy-path (human) still pending:** managed mode challenges automated/headless browsers, so a real successful submit (widget solved by a person → 201 + `ProfessionalLead` row) can't be produced headlessly. One manual completion by a human on `staging.medidocs.app/for-clinics/` is the last confirmation — not a bypass, just the nature of a real anti-bot widget.

**Remaining for production launch:** create the `-production` widget (domain `medidocs.app` only), swap the sitekey/secret, set `LEAD_TURNSTILE_HOSTNAMES=medidocs.app`. Not created until launch.

Variable names (values never here): `LEAD_TURNSTILE_SECRET_KEY` (api, secret), `LEAD_TURNSTILE_HOSTNAMES` (api), `NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY` (marketing build, public).

## B. Share-recipient schedule display

Root cause: `visit-summary.service.ts` built `instructionSummary` as `"<dose> · <frequencyCode> · <food>"`, so a pattern-scheduled medicine read `"1 tablet · PATTERN 1-0-1 · after"`. Fix: when a `pattern` exists, show it directly (`"1 tablet · 1-0-1 · after"`); standard codes (OD/BD/…) stay as clinical shorthand. One change covers the JSON share view **and** the PDF (the worker renders the same string). Regression test added (asserts `1-0-1`, never `PATTERN`). **Sharing media:** the Session-10 R7 clip showed the defect, so R7 was re-recorded against the fixed stack (recipient now shows `1-0-0`/`1-0-1`), re-encoded, and republished with a new content hash (`share-doctor-en.53fb42b6.mp4`, etc.); the old immutable hash stays in R2. Frame-verified clean — no `PATTERN`, and the QR/localhost frame still excluded.

## C. Cloudflare Web Analytics

**Approved role only:** aggregate marketing-site traffic + Core Web Vitals. No custom events, no CTA/form events, no manual beacon POSTs.

**Built:** a deliberate, manual beacon component (`components/AnalyticsBeacon.tsx`) that renders the official Cloudflare snippet **only** on marketing-web and **only** when `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` is set. Never in patient-web, never on `/s/<token>` share pages (§32/§33).

**Live on staging (2026-08-12).** A dedicated **staging** Web Analytics site was created in the dashboard for `staging.medidocs.app` (manual install). Its public token `3e2da448…` is baked into the staging build; the manual beacon renders (verified server-rendered in the deployed HTML) and reports to `cloudflareinsights.com/cdn-cgi/rum`. CSP was opened by exactly two origins — `https://static.cloudflareinsights.com` (`script-src`) and `https://cloudflareinsights.com` (`connect-src`), no wildcards. Browser check: beacon loads with **no CSP errors**.

**⚠ Residual: duplicate auto-injection (needs one dashboard toggle).** A **pre-existing** `medidocs.app` Web Analytics site is set to **automatic** injection, and Cloudflare's edge injects *its* beacon (token `9bb7272d…`) onto the `staging.medidocs.app` subdomain too. So the live browser currently sees **two** beacons — our deliberate manual one (in our HTML) and the edge-injected one (not in our HTML). To make only the deliberate beacon run (§18/§36), the pre-existing `medidocs.app` site must be switched from **Automatic** to **Manual** in the dashboard (Analytics & Logs → Web Analytics → that site → Manage → disable automatic installation). That also removes the uncontrolled beacon from `app./admin.medidocs.app`, which §32/§33 want analytics-free anyway. Until then staging RUM is double-counted (harmless test data). **Production launch requires this toggle done first**, plus a separate production site for `medidocs.app` (§19) with only the manual snippet.

## D. First-party acquisition attribution

**Contract (§24):** only the controlled value `website` is recognised. `normalizeAcquisitionSource()` maps anything else to `null` — never a free string, referrer, UTM, phone, or health data.

**Flow:** the marketing CTA sends `app.medidocs.app/?src=website`; patient-web captures `?src` on first load (`lib/acquisition.ts`, in the app-wide `InstallPromptListener`) into `localStorage`, **first-touch** (never overwrites an existing value), and sends it with OTP verify. The API persists it **once, at account creation only** (`User.acquisitionSource`, migration `20260812060048_user_acquisition_source`) — a returning patient can never overwrite or backfill it. No account is created just from opening the URL; attribution lands at successful identity establishment (§26).

**Semantics verified by tests:** `website` persisted at first sign-in; unknown ignored → null; no source → null; first-touch (revisit doesn't overwrite, later source doesn't backfill).

## E. Funnel — what's now measurable

| Stage | Source | Measurable? |
|---|---|---|
| Marketing traffic | Cloudflare Web Analytics | **Live on staging** (manual beacon) — pending the auto-injection toggle for a clean single count |
| Website-attributed accounts | `User.acquisitionSource = 'website'` count | **Yes** |
| …new in window | same, `createdAt` window | **Yes** |
| Activation (≥1 medicine) | website accounts owning a profile with ≥1 medication | **Yes** |
| Professional leads / last 24h | `ProfessionalLead` rows | **Yes** (Session 10) |

Intentionally omitted: per-page clickstream, CTA-hover/section events, a precise signup-vs-account intermediate step (no noisy event infra for a perfect 4-step funnel, §27). All surfaced as **aggregate counts** in the daily `operational-report` (`websiteAttributedAccounts`, `…Last24h`, `…Activated`, plus the lead counts) — no patient identity, no medicine content.

## F. Privacy boundary (§31)

- **Cloudflare Web Analytics** receives only the service's standard browser/performance signals — no custom data. Live on staging; a single deliberate beacon only.
- **First-party product data** holds `acquisitionSource = website` (or null) on the user — nothing else marketing-related.
- **Lead system** holds professional business-contact fields.
- **No marketing analytics system ever receives** medicine names, diagnoses, prescriptions, reports, glucose, allergies, caregiver health data, or lead email/phone/message. Lead fields never go to analytics, URLs, or logs; the ops report logs only aggregate counts.

## G. Rollback / disable

- Analytics: unset `NEXT_PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` → beacon renders nothing.
- Turnstile: it's fail-closed by design; to intentionally disable lead collection, that's a product decision, not an env toggle. The test keys can be swapped/removed on the medpass-dev api service.
- Attribution: the `User.acquisitionSource` column is additive and nullable; ignoring it is harmless.

## H. Closeout verification (2026-08-12)

**Turnstile widget** — restricted to `staging.medidocs.app` only (managed mode); `localhost` removed. Local/automated dev uses Cloudflare public test keys, keeping real vs. test credentials cleanly separated.

**Lead-submit failure root cause = CORS (not the phone field).** A human test solved the widget ("Success!") but the submit showed the generic error. Investigation:
- The phone `17133533453` (no `+`) **passes** validation — the regex `^\+?[0-9 ()-]{6,20}$` makes `+` optional — and the controller validates *before* Turnstile, so phone was never implicated.
- The api logs showed **no** POST from the user (only curl tests, which bypass CORS). The browser preflight from `https://staging.medidocs.app` returned 204 **without** `access-control-allow-origin`, while the patient-app origin got it. Root cause: the marketing origin was missing from the api's `CORS_ORIGINS` (it lists the patient/admin app origins only). The browser blocked the POST before it was sent.
- **Fix:** added `https://staging.medidocs.app` to `CORS_ORIGINS` on the medpass-dev `api` service (live) and in `.railway/railway.ts`; added `https://medidocs.app` to `.railway/railway.prod.ts` as launch-prep (file only, not applied). Verified live: preflight now returns `access-control-allow-origin: https://staging.medidocs.app`, and a real cross-origin `fetch()` from the marketing browser origin now completes (reads a `turnstile_failed` 400 for a bogus token) instead of throwing a CORS error. The happy-path 201 still needs one human widget solve (managed mode challenges automation).

**Lead-form error UX** — the form no longer collapses every failure into one generic line. It parses the ApiProblem (`code` + `errors[]`, the api serializes Zod issues under `errors`) and shows: field-level messages beside the offending field with `aria-invalid` (verified live for both `email` → "Enter a valid email address." and `phone` → "Enter a valid phone number…"), a "please complete the verification" message for `turnstile_failed`, a wait-and-retry message for `rate_limited`, and the generic message only as a true fallback. The rest of the form is preserved on error (verified: a filled name survives a rejected submit), and the single-use Turnstile token is kept on validation errors (server checks Turnstile after validation) but reset on `turnstile_failed`/generic. Server-side validation and Turnstile are unchanged — the fix is presentation only.

**Web Analytics (after the user switched the `medidocs.app` site to Manual)** — verified by real browser/network inspection:
- `staging.medidocs.app/for-clinics/`: exactly **one** beacon, our staging token `3e2da448…`; the old auto-injected token `9bb7272d…` is gone; RUM POST → **204**; **zero** CSP violations.
- `app.medidocs.app` and `admin.medidocs.app`: **no** beacon script, **no** `cloudflareinsights.com` requests, **no** RUM — the edge auto-injection is off everywhere.

Production launch still needs: a separate `medidocs.app` Web Analytics site (manual) + `-production` Turnstile widget, and the prod api `CORS_ORIGINS` line applied.
