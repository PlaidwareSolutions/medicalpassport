# Landing Page — Session 0: Current-State Audit

**Date:** 2026-08-11 · **Status:** COMPLETE — Session 0 deliverable per [SPEC.md](SPEC.md) §46/§48
**Method:** direct repository inspection this session (code over docs; [../22-implementation-plan.md](../22-implementation-plan.md) consulted for stage status). Every "verified" below cites the file(s) inspected. Nothing in this audit changed application behavior.

This audit answers four questions: what exists and can be reused; which SPEC assumptions are correct or incorrect; which public claims survive verification (fed into [02-marketing-claims.md](02-marketing-claims.md)); and what the implementation risks are.

---

## 1. Repository and platform inventory

### 1.1 Monorepo shape

pnpm workspace (`apps/*`, `packages/*`), Turbo tasks `build/generate/typecheck/lint/test/dev` (`turbo.json` — note: `build.env` allowlist is exactly `["NODE_ENV", "NEXT_PUBLIC_API_URL"]`; any new `NEXT_PUBLIC_*` var for marketing-web must be added there or Turbo strips it). Node ≥ 20 (CI uses 22), pnpm 9.15.9 pinned via `packageManager`. Existing apps: `api` (NestJS), `patient-web` + `admin-web` (Next.js **15.5.20**, React 19), `worker`, `cron`, `mobile-native` (deferred stages 9–10, not shippable). `apps/marketing-web` does not exist yet.

### 1.2 Design system — reusable with care

- `packages/design-tokens/src/index.ts` — single `tokens` object: `primary: "#0f6b54"`, `primarySoft: "#e3f2ed"`, semantic danger/warning/info/success pairs, rem type scale (16px minimum body), `size.touchTarget: "48px"`, spacing 4/8/16/24/32px, radii. `cssVariables()` emits a `:root{…}` string; patient-web injects it via a `<style>` tag in `app/layout.tsx` together with an inline `globalCss` literal (which already includes `prefers-reduced-motion` and `:focus-visible` rules). **No Tailwind, no CSS framework anywhere** — marketing-web should follow the same tokens-plus-inline-CSS approach, not introduce one.
- `packages/ui-web/src/` — 12 client components (`Button`, `Card`, `Chip`, `Banner`, `SectionTitle`, `ChoiceGrid`, `TurnstileWidget`, …), all styled from `var(--color-*)`. Source-only package: consumers must list it in `transpilePackages` (both existing next configs do).
- **Fonts:** there are no webfonts and no `next/font` — `tokens.font.family` is a system stack ending in Noto Sans/Devanagari/Telugu/Nastaliq-Urdu, relying on device-installed fonts. CI installs `fonts-noto-core` for Playwright. A public marketing page aiming for consistent first-impression typography (especially Urdu Nastaliq) may need to make a deliberate webfont decision — flagged as a Session 4 (design system) question, not decided here.

### 1.3 Localization — dictionaries reusable, routing is not

- `packages/localization` — hand-rolled: `t(locale, key, params)` with English fallback, `MessageKey` typed off the `en` dictionary, `direction()` for RTL, `LOCALE_NAMES` native-script labels. Dictionaries `en/hi/te/ur` each carry ~718 keys with full parity and real native-script content. **hi/te/ur are DRAFT pending professional review** (docs/34 launch gate).
- Patient-web's runtime (`apps/patient-web/lib/i18n.tsx`) selects locale from `localStorage` (`medpass_locale`) client-side and sets `document.documentElement.lang/dir` in an effect. **This cannot be reused verbatim for the marketing site**: a static SEO-indexable page needs per-locale routes (`/`, `/hi/`, `/te/`, `/ur/` — exactly what SPEC §29 prescribes) with locale resolved at build time, `lang`/`dir` in static HTML, and `hreflang` alternates. The `t()` engine and message-file pattern are reusable; the delivery mechanism is new work.

### 1.4 TTS audio pipeline — directly reusable

`apps/patient-web/scripts/generate-guidance-audio.mts` (`pnpm --filter @medpass/patient-web generate:audio`): GCP Text-to-Speech REST with an API key (`GOOGLE_TTS_API_KEY`, gitignored `.env`, GCP project `medpass-tools`), voice pinned `{en,hi,te,ur}-IN-Chirp3-HD-Achernar`, MP3 @ 0.95 rate. Idempotent: filenames are `{id}.{locale}.{sha256(text).slice(0,8)}.mp3`, existing files skipped, orphans deleted; a manifest + drift-guard test (`lib/guidance-audio.test.ts`) keeps copy and audio in sync. 264 MP3s (66 entries × 4 locales) are committed and live. **SPEC §36's "reuse the product's established spoken-content pipeline" is fully satisfiable** — marketing narration can use the same script pattern with its own entries file, keeping the same voice across site and app.

### 1.5 Playwright — strong base, video recording is net-new

`apps/patient-web/playwright.config.ts` boots the real stack (built API on :4000 + `next start` on :3000), seeds a real account via OTP in `e2e/global-setup.ts` (fixture written to `e2e/.auth/`), sets locale per-test via an initScript writing `medpass_locale`, and runs reflow (320px), axe, and behavior suites. **No `video:` option is configured anywhere in the repo** — SPEC §34's deterministic recording pipeline builds on this infra but the recording, cropping, compressing, poster/caption steps are all new. Turnstile note for demo flows: automated Chromium never receives a Turnstile token (verified during platform bring-up) — demo recordings must use seeded sessions/storage state, not the live login happy path, or use Cloudflare's official test sitekeys on staging.

### 1.6 CI — one workflow; deploy jobs are new territory

`.github/workflows/ci.yml` (the only workflow): push to `main`/`foundation` + PRs; gitleaks → install → prisma migrate/drift-check → build → typecheck → tests → Playwright (chromium + `fonts-noto-core`). ~20–25 runner minutes per push. `deploy-staging` is a main-gated echo stub; real deploys are Railway's push-to-`foundation` integration, ungated by CI. A wrangler (Cloudflare) static deploy job for marketing-web would be the repo's **first real CI deploy path** — SPEC Session 6 should treat it as such (secrets: a Cloudflare API token with Workers/Pages scope, currently not provisioned).

### 1.7 Cloudflare / Railway / R2 — what is and isn't in-repo

- **No Cloudflare config exists in the repo** (no wrangler.toml, no wrangler dependency). All DNS/TLS/WAF/cache/Turnstile configuration was applied directly via the Cloudflare API and is documented (not tracked as IaC) in [../26-cloudflare-edge-and-r2-architecture.md](../26-cloudflare-edge-and-r2-architecture.md).
- Live hostnames: `app./api./admin.medidocs.app` (project `medpass-prod`) and `staging-app./staging-api./staging-admin.medidocs.app` (project `medpass-dev`), all proxied, Full (strict) TLS, HSTS. **Apex `medidocs.app` serves nothing; `www.` and `assets.` don't exist; `staging.` doesn't exist** — all four are free for this project, matching SPEC §7.
- **Cloudflare zone is on the Free plan**: exactly one custom rate-limit rule exists and it is already spent on OTP-request protection. HTTP/3 is deliberately disabled zone-wide (QUIC black-holing incident, docs/22 Stage 11). The shared Cloudflare account hosts unrelated client projects — only clearly `medpass-`/`medidocs-`-scoped resources may ever be touched or created.
- Railway IaC: `.railway/railway.ts` (medpass-dev) / `.railway/railway.prod.ts` (medpass-prod). Marketing-web should NOT become a Railway service (SPEC §8 agrees); no IaC change is expected beyond none at all.
- R2: `packages/object-storage` factory picks R2 when `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_PREFIX` are set; buckets are `${prefix}${purpose}`. `medpass-dev-public-assets` and `medpass-prod-public-assets` exist but are **unused and not publicly bound**. SPEC §9 prefers a dedicated `medidocs-marketing-assets` bucket instead — see OD-LP-9; either way the public custom-domain binding (`assets.medidocs.app`) is net-new. Operational note: R2 credentials live in Railway env; past bucket ops were done via `railway run` so secrets never left the platform.

### 1.8 Template for the future leads endpoint (Session 10, not now)

`apps/api/src/modules/auth/auth.controller.ts:37-51` is the copy-verbatim shape: `@Public()` (global-guard bypass in `common/auth.guard.ts`, which also enforces the `x-requested-with: medpass` CSRF header) + `@RateLimit({ name, limit, windowSeconds })` (Postgres fixed-window buckets, `common/rate-limit.guard.ts`) + `verifyTurnstile` (`common/turnstile.ts`, pure function, skips when unconfigured) + `parseWith` zod validation + RFC7807 `ApiProblem` errors. Client widget: `packages/ui-web` `TurnstileWidget` (renders nothing without a site key). A `POST /v1/public/leads` endpoint has every building block already proven in production.

### 1.9 Analytics — nothing implemented

`packages/domain/src/analytics-events.ts` defines a 24-name `ANALYTICS_EVENTS` const with **zero emitters** (two TODO call-sites). Server side is pino structured logs with PHI redaction (`packages/observability`) and the daily `operational-report` cron; no observability/analytics vendor exists (OD-13 open). **Constraint for SPEC §42:** Cloudflare Web Analytics (the free, cookieless, already-in-stack option) measures pageviews/Core Web Vitals but does not support custom events — the SPEC's funnel events (`hero_start_click`, `clinic_lead_submit`, …) need either Cloudflare Workers Analytics Engine, a tiny self-hosted event endpoint on the existing API, or a descoped pageview-only launch. Feeds OD-LP-8.

### 1.10 Patient CTA target — verified real

The conversion path SPEC §1 depends on exists: `app.medidocs.app` serves patient-web with phone+OTP login (`app/login`), Turnstile-guarded, voice-OTP transport in production, public `/tour` and `/help` reachable unauthenticated (useful secondary link targets for the landing page). Query-string handling for an attribution parameter (`?src=website`, SPEC §43) does not exist yet — patient-web currently ignores unknown params (harmless), and *capturing* attribution would be new app-side work requiring its own privacy decision.

---

## 2. SPEC assumption check

| SPEC § | Assumption | Verdict |
|---|---|---|
| §1 | `app.medidocs.app` is the live patient app with a working signup path | **Correct** (verified live during Stage 11; login flow inspected) |
| §3.2 | PDF / WhatsApp sharing might be roadmap-only | **Better than assumed** — PDF export and WhatsApp-formatted text are implemented (see §3 below); WhatsApp is a client share-intent (`wa.me`), not a WhatsApp Business integration, and both render **English-only** today |
| §3.2 | Offline reminders unproven | **Correct to withhold** — not implemented or verified in the current product; the only notification path found is server-push via the service worker; do not claim publicly |
| §3.2 | Drug-drug interaction checking may not be live | **Correct** — no interaction data and no engine; vocabulary keys only (OD-3/OD-4 blocked on licensed data) |
| §6/§29 | Per-locale routes `/hi/ /te/ /ur/` are the right localization shape | **Correct, and necessary** — the app's localStorage-based locale mechanism is not reusable for static SEO pages (see §1.3) |
| §7 | Apex, `www.`, `assets.`, `staging.` are available | **Correct** — none currently exist/serve content |
| §8 | Static export on Cloudflare; no new Railway service | **Correct and consistent** with docs/00's platform split and Stage 11 cost-controls posture. One caveat: `headers()` in next.config **does not work under `output: "export"`** — cache/security headers must be set at the Cloudflare layer instead (patient-web's header config is not a transplantable pattern) |
| §9 | Dedicated marketing bucket preferable | **Reasonable** — `*-public-assets` buckets exist but are empty/unbound, so there's no migration cost either way; naming must be clearly medpass/medidocs-scoped in the shared account (OD-LP-9) |
| §26 | Postgres + Turnstile + rate limiting for leads is achievable | **Correct** — every building block exists and is production-proven (§1.8) |
| §34 | Deterministic Playwright recordings are feasible | **Correct with gaps** — seeding/locale infra exists; video recording, post-processing, and the Turnstile-vs-automation constraint are new work (§1.5) |
| §36 | The product's spoken-content pipeline can be reused | **Correct** — directly reusable, same pinned voice across 4 locales (§1.4) |
| §42 | Custom funnel events are implementable | **Needs a decision** — no analytics exists; the zero-cost default (Cloudflare Web Analytics) cannot record custom events (§1.9, OD-LP-8) |

---

## 3. Verified capability inventory (evidence for the claims ledger)

Full claim-by-claim treatment lives in [02-marketing-claims.md](02-marketing-claims.md); this is the underlying evidence.

**Implemented and inspected:**

- **Sharing** — time-limited links (UI 1h/24h/7d, server cap 30 days; SHA-256 token hash only), QR (`qrcode` in `share/new`), server-rendered PDF (Puppeteer, `apps/worker/src/processors/pdf-render.ts`; regenerated per request, never stored), WhatsApp-formatted text (`visit-summary-text.ts` + `wa.me` intent), revocation (patient + admin incident path), per-access logging (`ShareAccessEvent`, patient-visible at `GET /shares/:id/accesses`). **Viewing doctor needs no account** — `GET /public/shares/:token` is `@Public()`, `/s/[token]` renders outside the app shell. Live content aggregation, never a frozen snapshot. Gate: docs/22 Stage 7 marks sharing "**Requires security review** before production exposure."
- **Offline** — IndexedDB caches (`packages/offline-sync`: medications, timeline, mutations, conflicts), offline dose recording with queue + sync (`POST /sync`), conflict review UI, offline/syncing indicators, Serwist offline shell. The SW deliberately never caches `/v1/` responses (no PHI in caches). **Not offline:** reminders (see §4).
- **Safety findings** — duplicate-ingredient exact/partial, therapeutic-class overlap, allergy-ingredient match, plus `uncertain_normalization`, `schedule_conflict`, `dose_differs_from_prescription` (`apps/api/src/modules/safety/safety-rules.ts`), full traceability, never-deleted findings. Gate: docs/22 Stage 6 "**Requires clinical validation** before launch."
- **Reminders** — timeline + dose events, real web push (VAPID, `packages/notifications`), quiet hours, refill reminders, missed-dose reconciliation (2h grace), caregiver escalation with per-medicine critical bypass. **Channels that genuinely deliver today: web push + in-app.**
- **Capture/OCR** — camera/photo → presigned R2 upload (magic-byte + checksum verification), Tesseract.js OCR (local, English print only), candidates for exactly **three fields** (brand name, frequency, food instruction — dose amount deliberately excluded as hazard-critical), per-field confirm/reject UI, medicine search, manual entry.
- **Caregivers** — invitations w/ expiry, 10 granular scopes (`packages/authorization` policy engine), revocation, dependent profiles + claim flow, patient-visible caregiver access log. Caregivers can never manage caregivers/consents.
- **Languages** — 4 dictionaries at full key parity, Urdu RTL via `direction()` → `document.dir`, read-aloud (guidance MP3s → browser TTS → graceful no-op), 264 committed MP3s edge-cached in production.

**Not implemented (public claims must avoid):**

- **Drug-drug interaction, drug-condition, food, alcohol checking** — finding-type vocabulary only (`packages/clinical-rules` is an explicitly inert scaffold); no data source (OD-3/OD-4).
- **SMS reminder delivery** — code path complete (`TelnyxSmsSender`, consent cascade, delivery webhook) but undeliverable: Telnyx toll-free verification / India DLT platform-blocked (docs/22 Stage 4). Production OTP uses **voice**, not SMS.
- **WhatsApp message delivery** — no WhatsApp Business API anywhere (OD-10); only the patient-initiated `wa.me` share intent.
- **Offline reminders/notifications** — not implemented or verified in the current product; do not claim publicly.
- **Patient data export / account deletion** — **no endpoint, no UI** (full controller-route sweep; nearest neighbors are the visit-summary PDF and the operational backup cron, neither is a patient-facing export). docs/18's deletion flow is a plan. Constrains the Trust section and the `/privacy` page: do not promise export/erasure mechanics that don't exist.

---

## 4. Claim discrepancies vs. earlier internal drafts

- The superseded [../35-public-landing-page-plan.md](../35-public-landing-page-plan.md) feature grid included "your data, exportable and deletable" — **wrong**, per §3 above. SPEC.md §13/§21 wording avoids this; the claims ledger pins it.
- Any copy pattern of the form "duplicates, class overlaps, **interactions**…" (docs/00's product description bundles them) must be split for marketing: the first two are real, interactions are not live.
- "Layered reminders (in-app, browser push, SMS, WhatsApp, caregiver)" from docs/00 is aspiration; only in-app + push deliver today (caregiver escalation exists as in-app/push notifications to the caregiver).

---

## 5. Risks and constraints for later sessions

1. **Catalog depth** (biggest content risk): the medicine catalog is a **~12-product dev seed** (`packages/database/src/seed.ts`; docs/22 Stage 2 "Mocked" — licensed Indian medication DB is OD-3, a Product+clinical decision). Search-based add and duplicate detection demo beautifully against seeded brands but the public site must not imply a comprehensive Indian medicine database, and demo recordings must stick to seeded data. Worth an explicit business conversation before Session 7 copywriting.
2. **Launch-gate stack-up**: safety-rule wording needs clinical validation (Stage 6 gate, H-27), sharing needs security review (Stage 7 gate), hi/te/ur copy is DRAFT pending professional review, and docs/29's production-readiness items (legal/DPDP review, DPO designation) remain open. The marketing site can be *built* in parallel but its **launch** inherits these gates wherever its claims touch them.
3. **Privacy-page honesty**: with export/deletion unbuilt and DPDP review open, `/privacy` drafting (Session 12) must describe what the product actually does today, not docs/18's target state. OD-LP-6 owns sign-off.
4. **Cloudflare Free-plan ceilings**: 1 rate-limit rule (spent), fixed 10s windows. Lead-form abuse protection therefore rests on the app-level `@RateLimit` + Turnstile, not the edge. Cache rules have headroom.
5. **Static-export header gap**: security/cache headers for marketing-web must be configured at Cloudflare (or `_headers` if the chosen deploy target supports it) — `next.config` `headers()` silently doesn't apply to exported output.
6. **New deploy surface**: wrangler + a Cloudflare deploy token would be the first non-Railway deploy path and the first real CI deploy job; treat provisioning + least-privilege scoping as explicit Session 6 work.
7. **Shared Cloudflare account**: unrelated client projects live in account `db356ac4…`. Every bucket/DNS/Worker created for this project must be unambiguously medidocs/medpass-scoped.
8. **Turnstile vs. automation**: demo recordings can't pass real Turnstile in headless browsers (working as designed); recording flows must start from seeded storage state or use Cloudflare's official test sitekeys.
9. **Attribution touches the app**: SPEC §43's `?src=website` capture requires a patient-web change and a privacy decision — keep it out of marketing-web-only sessions and schedule deliberately (Session 11 at the earliest).
10. **Analytics gap** (OD-LP-8): no mechanism exists for custom events; choosing one (Workers Analytics Engine / self-hosted endpoint / pageview-only) changes Session 11's scope materially.

---

## 6. Reuse summary (what Sessions 5–13 get for free)

| Need | Reuse | Net-new |
|---|---|---|
| Design tokens, components | `packages/design-tokens`, `packages/ui-web` (via `transpilePackages`) | Marketing-specific layout components; webfont decision |
| Localized strings | `packages/localization` `t()` engine + dictionary pattern | Per-locale routes, build-time locale resolution, hreflang; marketing dictionaries |
| Narration audio | `generate-guidance-audio.mts` pattern, pinned Achernar voice, hash-keyed idempotency | Marketing entries file + bucket publishing (vs. committed `public/`) |
| Demo recordings | Playwright config, real-stack boot, seeding, per-locale initScript | `video:` recording, post-processing pipeline, fictional demo dataset, poster/caption generation |
| Lead endpoint | `@Public()`/`@RateLimit`/`verifyTurnstile`/`parseWith`/`ApiProblem` template; `TurnstileWidget` | The endpoint itself, schema, storage table, ops-report surfacing (Session 10) |
| Hosting/deploy | Cloudflare zone, DNS/TLS patterns, R2 factory | wrangler deploy job + token, apex/`www`/`assets`/`staging` records, bucket + public binding |
| Analytics | 24 predefined event names (`analytics-events.ts`); pino/PHI-redaction conventions | Everything else (OD-LP-8) |

**Session 0 gate: no implementation performed.** Next: [01-decisions.md](01-decisions.md) (decision register) and [02-marketing-claims.md](02-marketing-claims.md) (claims ledger), then STOP for review per SPEC §46.
