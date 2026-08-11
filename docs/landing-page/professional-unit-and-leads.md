# Landing Page — Session 10: Professional Unit + Clinic Lead System

**Date:** 2026-08-12 · **Status:** LIVE on `https://staging.medidocs.app` (noindexed); production apex untouched. Enabled after the Stage-7 security review PASS ([stage7-sharing-security-review.md](stage7-sharing-security-review.md)) and the mandatory F1 live deploy.

## F1 prerequisite — deployed and verified (§2)

The Stage-7 F1 fix (app-wide `X-Robots-Tag: noindex` on patient-web, incl. the `/s/<token>` bearer page) was deployed via the normal mechanism (push `foundation` → Railway) **before** any professional content was enabled. Live on `staging-app.medidocs.app`: `/s/<token>` returns `x-robots-tag: noindex, nofollow` + `cache-control: private, no-store` + `referrer-policy: strict-origin-when-cross-origin`; app root also noindex; API `/readyz` green; patient login renders (no regression).

## The professional release unit (gate ON)

`PROFESSIONAL_UNIT_ENABLED = true` ([lib/release-flags.ts](../../apps/marketing-web/lib/release-flags.ts) — flag **retained**, not removed, so it can still build OFF). Enables together: **S9** (homepage Share), **S12** (professional bridge), **`/for-clinics/`** (C1–C7), and the professional lead path. Verified reversible: with the flag OFF the build emits no S9/S12, no `/for-clinics/` professional content (the route resolves to the not-found shell), and no `for-clinics` links anywhere.

### Homepage additions
- **S9 Share** — a P2 media row using the real Stage-7 share clip. Copy is precise: "Create a share with a QR code or a link that lasts as long as you choose… no MediDocs account… You can stop the link at any time, and see when it was opened." Chips: QR or link · you set how long it lasts · no doctor account · stop the link any time.
- **S12 bridge** — "Are you a doctor, pharmacist or clinic?" → `/for-clinics/`. No outcome/efficiency statistics.

### `/for-clinics/` (C1–C7, English-only V1)
C1 hero ("A clearer medication picture, brought by the patient") with the share media · C2 problem (zero statistics) · C3 "A structured list, not a shoebox of paper" with the recipient-summary media · C4 "No doctor account. No software to install." + the real two steps (**not** "no workflow change") · C5 patient-controlled access with the precise revocation bound ("Stopping a link ends future access through it — it can't recall a copy already downloaded") · C6 non-outcome value tiles · C7 lead form.

## Sharing media (R7)

Recorded via the existing `e2e-marketing` framework (`r7-share-doctor.spec.ts`), synthetic "Asha Demo" data. Published clean to `assets.medidocs.app` (hash-named, immutable): `video/en/share-doctor-en.{mp4,webm}` + `images/posters/share-doctor-en.jpg`. **Bearer-token safety (§6):** the QR-ready screen — which renders the full share link as plaintext *and* a `localhost` dev URL — was **deliberately excluded** from the published clip; it shows create-form → recipient-summary only, and the token appears nowhere in the video, poster, or emitted HTML (verified frame-by-frame and by grepping the export). The QR/link mechanism is carried by S9/C3 copy. 4.08s.

## Lead API (OD-LP-2, §13–21)

- `POST /v1/public/leads` — `@Public()`, `@RateLimit(lead_submit 5/hour/IP)` (app-level, **not** a Cloudflare zone rule), optional Turnstile (`LEAD_TURNSTILE_SECRET_KEY`, skipped when unset — the app-wide optional-vendor pattern), strict Zod schema, `ApiProblem`. Files: `apps/api/src/modules/leads/`.
- **Schema (`packages/validation/src/leads.ts`)** — `.strict()`: Name, Organization, Role (enum), City, Email OR Phone (≥1), optional Message, `consentToContact: true` required. **Any unknown field — especially patient/health data — is rejected**, never stored.
- **Model (`ProfessionalLead`)** — business contact fields + `source` (controlled enum `website-for-clinics`, never caller-supplied) + `status` (`new`). No IP, no raw Turnstile response. Migration `20260811205244_professional_leads` applies via Railway `prisma migrate deploy`.
- **Response** returns `{ id }` only — no contact echo. No lead field ever enters analytics, URLs, or logs; the service logs only non-sensitive routing fields (org/role/city/leadId).

### Lead operational routing (§18, OD-LP-7 still open)
Leads **always persist** first. Notification is best-effort: with `LEAD_NOTIFY_EMAIL` unset (today), a new lead is surfaced by (a) the daily `operational-report` cron, which now logs `professionalLeadsNew` / `professionalLeadsLast24h` counts, and (b) a direct DB query. **Until OD-LP-7 designates an operational owner, leads are retrieved from Postgres** (`select … from professional_leads where status='new'`) — documented here, not lost. When an owner + transport exist, wire the send at the marked site in `leads.service.ts`.

## CSP (§25)

Extended with **exact** origins only: `script-src` + `frame-src` gain `https://challenges.cloudflare.com` (Turnstile); `connect-src` gains `https://staging-api.medidocs.app https://api.medidocs.app` (lead POST). No wildcards, no `unsafe-eval`. The Cloudflare Web Analytics beacon (`static.cloudflareinsights.com`) remains **deliberately blocked** (Session 11 decision) — Cloudflare auto-injects the script but CSP blocks it.

## Live verification (staging, §26–34)

- **Gate ON**: S9/S12 present, `/for-clinics/` 200, lead form present, "For doctors" nav (desktop). **Gate OFF** (tested, restored): no professional content emitted.
- **Lead endpoint (staging-api)**: valid → 201 (persisted, `{id}` only); no-contact → 400; patient-health field (`diagnosis`) → 400 (strict). One synthetic test lead created ("Dr. Live Test / Staging Test Clinic / example.com").
- **Responsive**: **0 horizontal overflow** at 320/390/1280 on both pages — fixed three real 320px issues found live: the header "For doctors & clinics" link crowding the sticky CTA (→ desktop-only), the S6 language strip's `overflow-x` grid escaping its container (→ 2×2 grid), and CTA buttons with `white-space:nowrap` not wrapping the long caregiving label (→ removed nowrap + `max-width:100%`).
- **A11y (`/for-clinics/`)**: one `<h1>`, all 8 form controls labelled, consent checkbox present, submit names the action, 5 landmarks; keyboard focus reaches fields.
- **Reduced motion**: zero `<video>` elements (posters only). **Perf**: home 6 JS files (Turnstile not loaded), `/for-clinics/` 7 (+1 lead-form client component); First Load JS 103 KB home / 110 KB clinics.
- **Noindex intact**: `x-robots-tag: noindex` + disallow-all robots + empty sitemap on staging; production build's sitemap includes `/for-clinics/` (ready for launch).

## §31 live share-cycle note

The full patient-create → doctor-open → revoke → fail cycle is covered by the sharing e2e suite (19/19, incl. "revoking a share makes it immediately and permanently inaccessible") and the R7 deterministic recording against the real stack. On **staging**, headless account creation is correctly blocked by Turnstile (the control working — same finding as prior sessions), so the full cycle isn't automatable there; the public share endpoint's live failure semantics (404 + no-store for an unknown token) were verified on `staging-api`.

## Hero decision (§9)

**Retained unchanged.** The current hero is already 12.2s across six calm beats (top of the 12–15s target); inserting a seventh sharing beat would risk franticness and exceed useful duration. Sharing is shown in S9/C3 instead. The modular slot remains available if we later rebalance.

## Remaining / open

- **OD-LP-2 routing owner** — configurable, awaiting OD-LP-7; leads persist + are query/report-surfaced meanwhile.
- **Turnstile widget** — the lead endpoint verifies when `LEAD_TURNSTILE_SECRET_KEY` is set and the form renders a widget when `NEXT_PUBLIC_LEAD_TURNSTILE_SITEKEY` is set; both unset today, so rate-limit + strict schema are the active protections. Provisioning a marketing-domain Turnstile widget (Cloudflare) + wiring the secret/sitekey is the one remaining operational step.
- Share-payload display roughness: the recipient summary prints "PATTERN 1-0-0 · any" (raw enum) — a pre-existing display nicety in `visit-summary.service.ts`, recorded as an observation; no product change made this session (§26).
