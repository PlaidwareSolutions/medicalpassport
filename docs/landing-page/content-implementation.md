# Landing Page — Session 7: English Content Implementation

**Date:** 2026-08-11 · **Status:** LIVE on `https://staging.medidocs.app` (noindexed) — awaiting the Session 7 gate review. Production apex untouched.
*(Unnumbered by convention; SPEC reserves 06/07 for the launch claim audit and post-launch report.)*

## Section state (S1–S14)

| § | Section | State | Notes |
|---|---|---|---|
| S1 | Hero | **Rendered** | P1 split; chips (free / no-install / "App languages:" product statement); CTA → `app.medidocs.app/?src=website`; QR card (desktop, build-time SVG); placeholder media |
| S2 | Problem | **Rendered — partially gated** | Three vignette cards with interim illustrations in the approved style; Story B ends neutrally; *tie-in sentence GATE(CLINICAL)* |
| S3 | Product reveal | **Rendered** | Stylized passport card, captioned "Illustrative example — not a live screen"; fictional medicine |
| S4 | Know | **Rendered — partially gated** | Photo→confirm (bounded), search, manual; *education sentence (MKT-014) GATE(CLINICAL)* |
| S5 | Remember | **Rendered — partially gated** | Timeline/taken/skipped/snoozed, optional browser reminders, refill awareness; *escalation sentence (MKT-022) GATE(CLINICAL)* |
| S6 | Accessible | **Rendered** | Bounded read-aloud wording ("guidance throughout the app…"); 4 language cards (ur card `dir="rtl"`); language names only — no unreviewed translations |
| S7 | Offline | **Rendered** | "Reminders need a connection." as emphasized body text |
| S8 | Caregiving | **Rendered** | All claims verified/ungated; variant CTA to standard app URL |
| S9 | Share | **RENDERED (Session 10)** — Stage 7 CLEARED | Real share media (r7); precise revocation wording. See [professional-unit-and-leads.md](professional-unit-and-leads.md) |
| S10 | Free | **Rendered — partially gated** | OD-LP-1 approved framing; chips: no-ads + no-paywall; *never-sold chip GATE(BUSINESS/LEGAL)* |
| S11 | Trust | **Rendered — partially gated** | Does-list rebuilt from ungated verified claims (organized/timeline/offline/caregiving); *"worth asking" GATE(CLINICAL)*, *"share on your terms" GATE(SECURITY)* |
| S12 | Professional bridge | **RENDERED (Session 10)** — Stage 7 CLEARED | Bridge band → /for-clinics/; no outcome statistics |
| S13 | FAQ | **Rendered — partially gated** | 9 Q&As always visible; Q5 (doctor account) GATE(SECURITY) absent; Q6 = honest negative only; Q9/Q10 caregiver-framed |
| S14 | Final CTA | **Rendered** | CTA + desktop QR |

## Architecture

- `components/sections.tsx` — all sections as **server components** (client JS remains: sticky header + ProductMedia only; the page's First Load JS is unchanged from the Session 5 shell at 103–105KB raw). `components/HomePage.tsx` composes them with GATE() comments at the S9/S12 seams.
- **Gated copy is not in the codebase.** `lib/content-gates.ts` defines `CLINICAL_CLAIMS_APPROVED` / `NEVER_SOLD_CHIP_APPROVED` (both false) and documents every enablement point; the approved wording lives in [04-content-spec.md](04-content-spec.md) and is added at the marked `GATE()` sites when a gate clears. Nothing gated reaches HTML, JS bundles, or assistive output.
- `lib/faq-items.ts` — single source for the FAQ section *and* the FAQPage JSON-LD, so structured data can never advertise omitted answers. JSON-LD graph: Organization + WebSite + FAQPage only (no medical schema, MKT-092).
- `components/PlaceholderMedia.tsx` — intentional media placeholder: PREVIEW badge, play motif, per-slot label, "real app footage arrives with media production" note; reserves 390/780 aspect (zero CLS on Session 9 swap); dashed border prevents any reading as final media.
- `components/Illustrations.tsx` — three interim S2 illustrations in the approved flat-warm style (ink/green/clay/sand, no faces); the commissioned canonical family replaces them file-for-file.
- `components/QrCard.tsx` — build-time SVG QR via the workspace's existing `qrcode` package (same `^1.5.4` as patient-web; zero new external code, zero client JS, zero runtime work). Target: exactly the approved attribution URL.
- CSS: pattern classes (P2 rows, statement panel, story/trust cards, FAQ, language strip) + a **CSS-only scroll reveal** (`animation-timeline: view()` behind `@supports` + `prefers-reduced-motion: no-preference` — no JS, content fully visible wherever unsupported or motion is reduced).

## Staging indexing protection (Session 7 §0)

Two independent, staging-specific layers — production structurally cannot inherit either:

1. **Build flavor:** `MARKETING_ENV=staging` (set by `deploy:staging` and the CI staging job) makes `robots.txt` emit `Disallow: /` and `sitemap.xml` emit an empty urlset. A plain production build (no env) emits the normal allow + apex-only sitemap.
2. **Host-scoped header:** `public/_headers` rule `https://staging.medidocs.app/*` → `X-Robots-Tag: noindex, nofollow, noarchive` — full-URL matching verified live; the rule can never match `medidocs.app`.

**Cutover note:** production launch requires **no un-noindexing step** — build without the env flag and attach the apex; the staging host rule simply never matches.

Verified live: `x-robots-tag` present on `/` and `/robots.txt`; robots disallow-all; empty sitemap.

## Verification summary (live, 2026-08-11)

- Typecheck/build/export green; **First Load JS unchanged** (all content server-rendered); HTML ~104KB (RSC payload duplication included).
- Gate greps on the deployed export: zero `for-clinics`/`c7-lead`/`clinic`; zero gated-copy strings; "interaction" appears only inside the FAQ's mandated honest negative.
- Browser (real Chromium, live): 0px horizontal overflow at 320/390/1280; h1 32px at 320; first Tab → skip link; 1×h1 + 11×h2 hierarchy; landmarks correct; reduced-motion shows all content (opacity 1); sticky CTA appears on scroll and no longer wraps (48px, `white-space: nowrap` fix caught in visual QA); page height 9.4k px at desktop. Only console error: the known CSP-blocked Cloudflare beacon (Session 11 decision, [infrastructure.md](infrastructure.md)).
- Deployed version `ae926520…`; screenshots for the gate: claude.ai/code/artifact/06c438f6-30d0-45a7-bea3-c0733f07d014.

## Deferred to Sessions 8–9 (placeholder inventory)

Hero montage (S1) · add-medicine clip (S4) · timeline clip (S5) · four-language strip media + narration samples (S6) · offline sequence (S7) · caregiver clip (S8) · canonical illustration family (S2, replacing the interim SVGs) · story narration listen buttons (deliberately absent until real audio exists — no fake controls) · OG image (lockup + product UI per the Session 4 ruling).

## Session 7 gate corrections (applied 2026-08-11, verified on staging)

1. **Stage-7 sharing leak:** public free-wording bounded to "create, maintain and **access**" in S10 and FAQ 1 while the sharing gate is OFF; the approved "…and share" wording returns through the gate when Stage 7 clears (MKT-001's ledger scope — which includes sharing — is unchanged; only the pre-clearance public rendering is bounded).
2. **Privacy FAQ:** exhaustive "Only people you invite… Nothing is public" replaced with bounded user-control wording ("isn't publicly listed… access you grant… remove at any time") — deliberately not a summary of the future privacy policy.
3. **Ownership wording:** "You own it." → "It's your record. It goes where you go."
4. **Language-claim classification** (also in the MKT-003 ledger row): en/hi/te/ur are technically implemented in the app; non-English product/marketing language *quality* remains subject to professional review; final non-English marketing recordings are not produced or published until that review clears; no fabricated translations.

## Deviations / notes for the gate

1. **S2 listen buttons omitted** rather than shipped as dead controls — narration arrives with Session 9 audio; the wireframe's opt-in listen pattern is unchanged, just not faked.
2. **S4/S5 pacing:** with real placeholder media and distinct chip rows they read as distinct steps ("get medicines in" vs. "live with them daily") — no redundancy observed; no merge recommended.
3. `qrcode` added to marketing-web's manifest — an existing workspace package at the existing version, not a new external dependency; flagged per the Session 7 QR instruction.

## Session 12 — draft legal pages (2026-08-12)

The `/privacy/` and `/terms/` stubs are replaced with full **draft** pages (`app/(en)/privacy/page.tsx`, `.../terms/page.tsx`) built on a shared `components/LegalPage.tsx` shell: a prominent `DRAFT — LEGAL REVIEW REQUIRED` banner, a review-state line, an anchor-link table of contents, semantic `h1/h2` structure, and readable `mkt-container-text` width — no new UI library. Content is plain-language and grounded in [privacy-data-inventory.md](privacy-data-inventory.md); it makes no compliance claims and no unsupported promises. Both pages stay noindexed (page-level `robots:{index:false}` + the staging host `X-Robots-Tag`). Reviewer placeholders (`[LEGAL ENTITY TO BE CONFIRMED BEFORE LAUNCH]`, contact/law/retention/children placeholders) are intentional. A launch-safety guard (`scripts/check-legal-placeholders.mjs`, wired into `deploy:staging`) fails a **production** build if those markers remain, and is a no-op on staging. Verified live: 0px overflow at 320/390/1280, draft banner visible, homepage + `/for-clinics/` regression clean, app/API/admin healthy. See [launch-governance-checklist.md](launch-governance-checklist.md).
