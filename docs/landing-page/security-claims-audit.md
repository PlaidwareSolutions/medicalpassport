# Security & Public-Claim Integrity Audit — Marketing Site (Session 15)

**2026-08-13. Pre-launch broad audit of the public marketing surface** (`staging.medidocs.app` + its lead path on `staging-api.medidocs.app`). Two questions:

1. **Security** — is there any material public-facing security/privacy regression or launch-risk on staging?
2. **Claims** — does every visitor-visible statement match the real product, the real implementation, approved policy, and the publication gate?

This is evidence-based: every finding below cites a live probe, a source path, or a build artifact. Nothing here changes production. Findings are classified **P0 / P1 / P2 / INFO**.

> **Headline: no P0, and no P1 on the marketing surface itself.** The one reachable "high" (a Next.js advisory) lands on the **patient app**, not the static marketing site, and is filed as a cross-surface P1 recommendation. Every visitor-visible claim maps to a verified capability or an approved-but-publication-gated policy. The truth-first gating (clinical claims, "never-sold" chip) is verified **absent from emitted output**, not merely hidden.

---

## Method

- **Live headers/CSP/cache** — `curl -sD -` across `/`, `/for-clinics/`, `/privacy/`, `/terms/`, `/hi/`, `/te/`, `/ur/`, plus the patient `/app` and `/s/<token>` share routes and the API.
- **Secret exposure** — repo grep (tracked files), built-bundle scan (`out/`), deployed source-map probe, public R2 bucket probe.
- **Dependencies** — `pnpm audit --prod`, cross-referenced against runtime reachability (static export vs. running server).
- **Lead endpoint** — synthetic **negative** tests against `POST /v1/public/leads` (malformed, health-data injection, missing-Turnstile, cross-origin). All requests were designed to be **rejected** — no lead was created, no spam generated. Kept to ≤4 POSTs to respect the 5/hour limiter.
- **Third-party requests** — headless Chromium network capture per route (cross-origin hosts only).
- **Claims** — reconciled the canonical copy (`lib/dictionaries/en.ts`) and the three draft locales against verified product capability, the gate flags, and the governance state; verified negative-capability disclosures, media-honesty labels, OG metadata, and legal-page draft markers live.
- **Production config** — read-only static review of `railway.prod.ts`, `public/_headers`, and `package.json` deploy scripts.

---

## A. Security findings

| ID | Finding | Severity | Evidence | Status |
|---|---|---|---|---|
| SEC-1 | **Next.js `15.5.20` is below the patched `15.5.21`** — advisories: App-Router DoS, Server-Actions SSRF, rewrites SSRF. **Not reachable on the marketing site** (`output: "export"` → no Next server, no App Router runtime, no Server Actions, no rewrites). **Reachable in principle on the patient app** (`app.medidocs.app` runs a Next server — confirmed by `x-powered-by: Next.js` and no `output:"export"`). | **P1 (patient app; INFO for marketing)** | `pnpm audit --prod`; `apps/marketing-web/next.config.mjs:9` (`output:"export"`); no `output` in `apps/patient-web/next.config.mjs`; both pin `next@15.5.20`. | **Open — recommend bump** to `next@15.5.21+` (patch, same minor) before public launch, with a patient-app rebuild + smoke. Not applied here: a shared-framework bump + relock + patient-app retest is outside a marketing-security audit's safe, narrowly-scoped authority. |
| SEC-2 | **`x-powered-by` left at default** on the patient app (`Next.js`) and API (`Express`) → minor stack/version disclosure. Marketing (static) does **not** emit it. | **P2** | `curl -I` on `/app` and `/v1/*`; no `poweredByHeader:false` in `patient-web/next.config.mjs`, no `app.disable('x-powered-by')` in `api/src/main.ts`. | Open — recommend `poweredByHeader:false` (Next) + `app.disable('x-powered-by')` (Express). Cosmetic; not launch-blocking. |
| SEC-3 | **Build-time dependency highs** (`sharp <0.35.0`, `postcss ≤8.5.17`, `brace-expansion`) flagged by `pnpm audit`. All are **build/tooling-only** and are **not present in the shipped static artifact** (no server runtime; no PostCSS/Tailwind in marketing; `sharp` is image-tooling not shipped). | **INFO** | `pnpm audit --prod`; marketing deps are only `next, react, react-dom, qrcode, @medpass/design-tokens`. | Open — resolve at the next routine dependency refresh. Not exploitable on the public surface. |
| SEC-4 | **API CORS preflight returns the full default method list** (`GET,HEAD,PUT,PATCH,POST,DELETE`). Harmless: the ACAO is **origin-gated** (not a wildcard) and the only public endpoint accepts `POST` only. | **INFO** | `OPTIONS /v1/public/leads` preflight. | Accepted — no action. |

**No P0. No P1 originating on the marketing surface.**

### Security posture verified clean (no defect)

- **Response headers (7 marketing routes)** — strong CSP (`default-src 'self'`; `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; **`frame-ancestors 'none'`**; scoped `script-src`/`img-src`/`media-src`/`frame-src`/`connect-src`), HSTS, `X-Content-Type-Options: nosniff`, no framework version leak. **No `Server`/build-hash disclosure.**
- **Share / patient routes** — `/s/<token>` and `/app` return `Cache-Control: private, no-store` + `X-Frame-Options: DENY` + `noindex` + `nosniff`. A share URL is never cacheable or indexable.
- **Lead endpoint** (`POST /v1/public/leads`) —
  - **Strict schema rejects health data.** Injecting `diagnosis`, `medications`, `patientId` → `400 validation_failed` `Unrecognized key(s) in object` (`.strict()` at `packages/validation/src/leads.ts:47`). The endpoint **cannot ingest patient/health data.**
  - **Turnstile enforced fail-closed.** A well-formed body with no token → `400 turnstile_failed`. A missing secret in a real deployment returns `503`, never fail-open (`leads.controller.ts:38-45`).
  - **Rate-limited** 5/hour/IP (app-level Postgres limiter; the Cloudflare Free-plan rule slot is deliberately not spent).
  - **Error bodies are minimal RFC-7807** (`type/title/status/code/correlationId[/errors]`) — no stack, no SQL, no internal paths.
  - **Attribution is server-fixed** — `source` is the constant `"website-for-clinics"` passed by the controller, not client input (`leads.service.ts` + `LEAD_SOURCES`). It cannot be spoofed.
  - **PII-minimized logging** — the success audit records `{leadId, organization, role, city, source, notifyConfigured}` only; **never** email/phone/name/message.
- **CORS is an allowlist, not a wildcard** — `https://evil.example` and `https://medidocs.app` (prod apex) receive **no** `access-control-allow-origin` on the staging API; only `https://staging.medidocs.app` is reflected (with `allow-credentials: true` against a *specific* origin — the safe pattern). This confirms **production CORS is not prematurely applied**.
- **No open-redirect** surface and **no admin route** on the marketing/app static output.
- **App handoff `?lang=` is correctly deferred** (Session-13 ruling) — the only app link is a fixed `https://app.medidocs.app/?src=website` (`CtaLink.tsx`); no user-controlled `?lang` is wired.

---

## B. Public-claim findings

| ID | Claim area | Verdict | Evidence |
|---|---|---|---|
| CLM-1 | **Free / no-ads / no-paywall** (`free.*`, `faq.a1`) | **Consistent — publication-gated** | Business-approved (ruling #6), bounded wording ("free for all patients to create, maintain and access"). Publication gated on counsel; appears only on **noindexed** staging. Governance already tracks this. |
| CLM-2 | **"Never sold" data commitment** | **Correctly ABSENT** | `NEVER_SOLD_CHIP_APPROVED = false` → the stronger MKT-072 chip is not emitted, while the bounded "No advertising in the patient experience" chip is shown. A deliberate conservative asymmetry (shows less, not more). |
| CLM-3 | **Clinical / safety / interaction capability** | **Correctly ABSENT + negatively disclosed** | `CLINICAL_CLAIMS_APPROVED = false` → S4 education, S5 escalation, S11 "worth asking about", FAQ-6 capability sentence not emitted. `faq.a6`/`trust.not_4` **affirmatively disclaim** interaction-checking and any "safe" declaration. |
| CLM-4 | **App vs. website language** | **Truthfully distinguished** | `faq.a3`: "The app supports English, Hindi, Telugu and Urdu. This website is currently in English…"; hero chip is prefixed **"App languages:"**. No implication the website is fully localized. |
| CLM-5 | **Sharing / revocation** (`share.*`, `clinics.c5_*`) | **Accurate, precisely bounded** | Stage-7 cleared 2026-08-12 (`PROFESSIONAL_UNIT_ENABLED = true`), S9 live-confirmed. Revocation wording is exact: "Stopping a link ends future access through it — it can't recall a copy already downloaded." |
| CLM-6 | **Photo / OCR** (`know.body`) | **Bounded, accurate** | "confirm what Medicine Passport reads — you check every detail before it's saved." No OCR-accuracy overclaim. |
| CLM-7 | **Reminders / offline** | **Accurate with honest bound** | "Turn on browser reminders" + "**Reminders need a connection**" (`offline.honest`, `faq.a8`). No SMS/WhatsApp reminder claim (correctly — those channels are blocked/nonexistent). |
| CLM-8 | **Caregiving** (`care.*`, `faq.a4/a10`) | **Accurate** | Grant/see/remove caregiver access — matches verified caregiver scopes + audit + revocation. |
| CLM-9 | **PDF summary** (`clinics.c3_body`) | **Accurate with honest bound** | "A PDF when paper is easier **(English)**" — English-only bound stated. |
| CLM-10 | **Media honesty** | **Correct** | `hero.media_note` ("Real app footage arrives…") renders **only** inside `PlaceholderMedia` (the no-asset fallback); with real footage present it is never shown. `reveal.card_caption` labels the static example card "Illustrative example — not a live screen." Audio note states it is the real English guidance voice, play-on-press. |
| CLM-11 | **OG / meta** | **No overclaim** | Title/description bounded (free, patient-held, mobile-browser, share-with-doctor); `og:url` canonicalizes to production; first-party hashed OG image on `assets.medidocs.app`. |
| CLM-12 | **Legal pages** | **Not presented as final** | `/privacy/` and `/terms/` carry **"DRAFT — LEGAL REVIEW REQUIRED"** live; placeholder body states "not yet published policy." |

**No P0/P1 claim findings.** No visitor-visible statement overclaims an unshipped or unvalidated capability.

### Negative-capability verification (§39)

The "does not" disclosures are present, rendered, and **translation-parity-preserved**:

- `trust.not_1…5` + `faq.a6`/`faq.a7` live on the homepage: does **not** diagnose/prescribe, start/stop, substitute, declare "safe", replace clinicians, or check interactions.
- The "does not declare any medicine safe" disclaimer survives verbatim-in-meaning in the **hi/te/ur** drafts (`trust.not_4` present and non-empty in each) — no locale silently drops a safety disclaimer. (Drafts remain unpublished pending professional review; the *claim structure* is parity-checked.)

### Feature-state matrix (gates ↔ live output)

| Gate flag | Value | Expected on public output | Live result |
|---|---|---|---|
| `CLINICAL_CLAIMS_APPROVED` | `false` | Clinical sentences absent | Absent ✓ |
| `NEVER_SOLD_CHIP_APPROVED` | `false` | "Never sold" chip absent | Absent ✓ |
| `PROFESSIONAL_UNIT_ENABLED` | `true` (Stage-7) | S9 share + S12 + `/for-clinics/` present | Present ✓ |
| `buildLocales()` (prod) | `["en"]` | Prod builds English only | Staging builds all 4 (gated); prod path = en-only ✓ |

Gated copy is confirmed **not emitted to HTML/JS/assistive output** — it lives in `04-content-spec.md`, not in the codebase, per the OD-LP-10 design.

---

## C. Third-party request inventory (§32-34)

Live headless capture. The **only** cross-origin hosts contacted, anywhere:

| Host | Purpose | Routes | Classification |
|---|---|---|---|
| `assets.medidocs.app` | First-party R2 marketing media (audio/images/posters/video) | `/`, `/hi/…`, `/for-clinics/` | First-party |
| `challenges.cloudflare.com` | Turnstile widget | **`/for-clinics/` only** | Cloudflare (bot mitigation) |
| `static.cloudflareinsights.com` + `cloudflareinsights.com` | Web Analytics beacon (aggregate pageviews + CWV; no cookies, no custom events) | all marketing routes | Cloudflare (RUM) |

**No** Google, Facebook/Meta, ad network, external font, or third-party tracker of any kind. This matches the CSP allowlist exactly.

**Share-token analytics leak (§31): NONE.** The patient app ships **no** analytics beacon (code grep + live). The `/s/<token>` share page's only cross-origin request is to the first-party API (`staging-api.medidocs.app`) to resolve the token — there is no tracker to leak a token into. The marketing `AnalyticsBeacon` is never mounted in patient-web or on share pages (`AnalyticsBeacon.tsx` docstring + live-confirmed).

---

## D. Secret exposure review (§10-13)

- **Repo (tracked):** no committed secrets; no `.env` tracked; the only DB URL is the CI test value `postgresql://medpass:medpass@localhost`. No Turnstile **secret** key, no private keys.
- **Built bundle (`out/`):** contains only **public** config — the staging Turnstile **sitekey** `0x4AAA…` and Web-Analytics **token** (both public by design) and the staging API URL. No secret/env patterns.
- **Source maps:** **not deployed** — `/_next/static/chunks/*.js.map` → 404; no `.map` in `out/`.
- **Public R2 bucket:** `assets.medidocs.app/` root → 404 (**no directory listing**); published paths are marketing-only (`audio/en`, `images/og`, `images/posters`, `video/en`). No patient data, logs, or manifests exposed.

---

## E. Production-config static review (§56, read-only — nothing applied)

- **CORS** — `railway.prod.ts` **stages** `CORS_ORIGINS="…,https://medidocs.app"` but it is **not applied**; the file comment is explicit ("authorizes CORS only; does not serve or cut over the apex"), and the live staging API rejects the prod-apex origin. Runtime resolves origins from env (`api/src/main.ts:20-22`).
- **No `deploy:production` script** — only `deploy:staging` (staging tokens, `MARKETING_ENV=staging`, `wrangler deploy`). There is no automated apex-cutover path; production launch remains a deliberate manual act.
- **No production Turnstile / Web-Analytics credentials** in the repo. No `medidocs-marketing-leads-prod` widget; staging build uses staging-scoped public tokens only.
- **Staging noindex** is host-scoped to `staging.medidocs.app/*` (`public/_headers`) — retained, and structurally unable to leak to the apex.

---

## F. Residual risks / recommendations

1. **SEC-1 (P1, patient app):** bump `next` to `15.5.21+` before public launch; rebuild + smoke the patient app. Trivially also moves marketing to the patched line.
2. **SEC-2 (P2):** disable `x-powered-by` on the patient app and API.
3. **SEC-3 (INFO):** clear build-time dependency highs at the next routine refresh.
4. **CLM-1/2/3 (governance, not defects):** the free/no-ads business claims and any clinical wording stay **publication-gated** — production must remain en-only and behind counsel sign-off before these go public. Already reflected in the launch-governance checklist; no code change needed, the gates enforce it.
5. **Claims ledger (`02-marketing-claims.md`)** is owned by a concurrent session and was **not** edited here; this audit is the Session-15 reconciliation of record and cross-references it.

## SEC-1 / SEC-2 closure (Session 16, 2026-08-13)

| ID | Status | Detail |
|---|---|---|
| SEC-1 | **RESOLVED** | Next.js `15.5.20 → 15.5.21` (patient/admin/marketing; single version, no skew; lockfile churn is next-family only). `pnpm audit` no longer reports the App-Router DoS / Server-Actions SSRF / rewrites SSRF advisories. Deployed to staging **and** prod via `foundation`; both apps report `ready`/`postgres:ok`. **Not a Next 16 migration.** |
| SEC-2 | **RESOLVED** | `poweredByHeader:false` (patient + admin Next), `app.disable("x-powered-by")` (Nest/Express API). Live-verified **absent** on staging + prod, patient app **and** API (it was present in the S15 audit). |
| SEC-3 (residual) | **ACCEPTED / INFO** | Remaining `pnpm audit` highs are transitive build-toolchain deps pulled through `next@15.5.21` — `sharp@0.34.5` (<0.35.0), `postcss@8.4.31`, `brace-expansion`. `postcss`/`brace-expansion` are **build-time only** (not in a runtime bundle). `sharp` is Next's optional image optimizer; **`next/image` is not imported anywhere in source** and no `images.remotePatterns` are configured, so the optimizer path is not exercised (and marketing is a static export that never ships sharp). **Not called vulnerability-free** — these clear when Next bumps them or at a routine refresh. |

The project is **not** vulnerability-free: build-time transitive highs remain (SEC-3), classified above by reachability. No secret rotation was performed — Session 15 found no exposure and the patch is not evidence of compromise (§8).

## Conclusion

The public marketing surface is **launch-clean from a security and claim-integrity standpoint**: strong headers/CSP, a hardened fail-closed lead endpoint that cannot ingest health data, an allowlist CORS with production correctly un-applied, no secret or source-map exposure, a first-party-only third-party footprint with no share-token leak, and a truth-first claim set whose gated statements are verifiably absent from emitted output. The only reachable "high" is a **patient-app** framework patch (SEC-1), filed as a pre-launch P1. The remaining launch blockers are unchanged and non-engineering (legal entity, counsel sign-off, mailbox provisioning, native-language review) — see [launch-governance-checklist.md](launch-governance-checklist.md).
