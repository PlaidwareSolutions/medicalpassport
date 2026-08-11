# Landing Page — Session 2: Information Architecture

**Date:** 2026-08-11 · **Status:** DRAFT for the Session 2 gate ("you approve the story") — no code, no visual design.
Companion: [04-content-spec.md](04-content-spec.md) (per-section content). Governed by [SPEC.md](SPEC.md) §6–§10, the rulings in [01-decisions.md](01-decisions.md), and the claims ledger [02-marketing-claims.md](02-marketing-claims.md).

---

## 1. Route map

| Route | Purpose | Launch state (per OD-LP-4) |
|---|---|---|
| `/` | Patient/caregiver landing story (14 sections, §3) | **Live at launch** (English) |
| `/for-clinics/` | Professional page + lead CTA (7 sections, §4) | Live at launch (English only — professionals are an English-comfortable audience; localizing this page is deliberately out of v1 scope) |
| `/privacy/` | Public privacy policy | Placeholder until Session 12; **published text requires OD-LP-6 approval** |
| `/terms/` | Terms of use | Same as `/privacy/` |
| `/hi/` `/te/` `/ur/` | Localized patient landing (mirrors `/` only) | **Built architecturally from day one, not publicly linked/indexed until professional translation review clears each locale** — no machine-translated copy marked complete (OD-LP-4) |
| `/404` | Not-found with CTA back to `/` | Live at launch |

Not created (SPEC §6 "do not create merely to fill navigation"): `/about/`, `/security/`, `/accessibility/` — revisit post-launch only on need. No blog.

**External link contract:** every patient CTA points to `https://app.medidocs.app/?src=website` (OD-LP-8). One source value site-wide in v1 — no per-section values, which would be the event-granularity OD-LP-8 declined. The app-side *capture* of `src` is a patient-web change scheduled with Session 11.

## 2. Navigation

**Header (sticky, minimal):** brand lockup "Medicine Passport · by MediDocs" (OD-LP-3) → `/`; language switcher (visible from day one; unreviewed locales listed as "coming soon" in their own script, never linked as finished); one CTA button "Create my free Medicine Passport". No menu of anchor links on mobile — the page *is* the navigation (scroll narrative). Desktop may add two quiet links: "For doctors & clinics" → `/for-clinics/`, "Help" → `app.medidocs.app/help` (public, verified).

**Footer (both pages):** repeat CTA block (S14), then: For doctors & clinics · Privacy · Terms · contact address(es) (**publication blocked on OD-LP-7**) · "MediDocs" company line · language switcher repeat. Footer is where MediDocs-as-company speaks; body copy stays product-voiced (OD-LP-3).

## 3. Homepage narrative — section order and IDs

SPEC §10's journey mapped to buildable sections. IDs are stable anchors (`#s2-problem` etc.); "See how it works" scrolls to S2.

| ID | Section (SPEC §) | Narrative role | Gate exposure |
|---|---|---|---|
| S1 | Hero (§11) | Recognition + promise + CTA | Language chip GATED-TRANSLATION; free chip wording GATED-BUSINESS/LEGAL |
| S2 | The problem — 3 stories (§12) | Emotional recognition | Story B product tie-in GATED-CLINICAL |
| S3 | Product reveal (§13) | "That's what Medicine Passport is for" | — |
| S4 | Know (§14) | Capability: understand what you take | Bounded copy (OCR 3-field, seeded catalog, "where available") |
| S5 | Remember (§15) | Capability: timeline + reminders | Escalation wording GATED-CLINICAL |
| S6 | Accessible by design (§16) | Languages, listen, large targets | GATED-TRANSLATION |
| S7 | Works offline (§17) | Reliability honesty | Honest negative on reminders (mandatory) |
| S8 | Caregiving (§18) | Family value + variant CTA | — |
| S9 | Share with a doctor (§19) | Capability: QR/link/PDF | **Entire section GATED-SECURITY (Stage 7)** |
| S10 | Free for patients (§20) | The promise, with sustainability | GATED-BUSINESS/LEGAL (final wording) |
| S11 | Trust (§21) | Boundaries as value | Wording GATED-CLINICAL/LEGAL; no export/deletion claims |
| S12 | Professional bridge (§22) | Route professionals out of patient story | — |
| S13 | FAQ (§23) | Objection handling | Mixed (per question) |
| S14 | Final CTA (§24) | Action | Same as S1 chips |

Gate legend (used throughout 04): **GATED-CLINICAL** = Stage 6 clinical validation / H-27 wording review · **GATED-SECURITY** = Stage 7 sharing security review · **GATED-TRANSLATION** = professional translation review · **GATED-BUSINESS/LEGAL** = OD-LP-1 final copy review / OD-LP-6. A gated element may appear in the content spec but is not approved public copy until its gate clears; how gates meet the launch date is **OD-LP-10** (open).

## 4. `/for-clinics/` — section order

| ID | Section (SPEC §25) | Gate exposure |
|---|---|---|
| C1 | Hero — "brought by the patient" | GATED-SECURITY (describes the share view) |
| C2 | The reconciliation problem | No-statistics rule (MKT-081) |
| C3 | What the professional sees | GATED-SECURITY |
| C4 | No new account required | GATED-SECURITY |
| C5 | Patient-controlled access | GATED-SECURITY |
| C6 | Why clinics might care | Non-outcome claims only |
| C7 | Lead CTA + form | Form fields provisional; workflow **OD-LP-2 (OPEN)** — Session 2 ships CTA + placeholder, Session 10 builds the form |

## 5. Localization architecture (OD-LP-4)

- **Per-locale static routes** (`/`, `/hi/`, `/te/`, `/ur/`), locale resolved at build time; `lang` and `dir` (Urdu `rtl`) in the static HTML — not the app's localStorage mechanism (audit §1.3).
- Marketing strings live in a marketing dictionary following `packages/localization`'s pattern (typed keys off `en`), separate from the app dictionaries — marketing copy is new text with its own review lane.
- **No forced language redirect** (SPEC §30): a dismissible one-line suggestion banner when `Accept-Language`/`navigator.language` indicates a supported, *published* locale ("हिंदी में देखें?"); user choice persisted; switcher always visible.
- `hreflang` alternates emitted **only for published locales**; unpublished locale routes carry `noindex` until their review clears — architecture supports all four from day one without pretending readiness.
- Urdu: full RTL layout verification per SPEC Session 13 checklist, not text-mirroring alone.

## 6. Media and audio placement (design-level; production is Sessions 8–9)

- Autoplay video is always **muted + playsinline + loop + poster**; below-fold clips `preload="none"`, loaded near viewport. Save-Data / reduced-motion / `prefers-reduced-motion` ⇒ posters and no nonessential motion; the page must be complete with zero video bytes (SPEC §32 hard requirement).
- Storyboard set mapped to sections: `01-hero`→S1 · `02-add-medicine`→S4 · `03-today-schedule`→S5 · `04-listen-language`→S6 · `05-caregiver`→S8 · `06-share-doctor`→S9/C3 · `07-offline`→S7. Demo recordings use **only seeded fictional staging data** (audit risk 1; catalog bound MKT-012).
- Narration audio (S2 stories, optionally S6): strictly opt-in listen buttons with visible playing state, pause/replay, transcripts — reusing the app's TTS pipeline pattern and pinned Achernar voice (audit §1.4). No autoplay audio anywhere, ever.
- All media served from the dedicated marketing bucket via `assets.medidocs.app` (OD-LP-9), hash-versioned filenames.

## 7. SEO skeleton

- Per-route unique `<title>`/description; canonical URLs; OpenGraph/Twitter card with a real product screenshot (brand lockup per OD-LP-3). Draft titles: `/` → "Medicine Passport — your medicines, one place, in your language | by MediDocs" (language phrase falls away if S1's chip is descoped at launch); `/for-clinics/` → "Medicine Passport for doctors & clinics | MediDocs".
- `sitemap.xml` (published locales only) + `robots.txt`. Structured data: `WebSite`, `Organization`, `FAQPage` only — **no medical/efficacy schema** (MKT-092).

## 8. Global accessibility behaviors (page-level; per-section behavior in 04)

Semantic landmarks and one `<h1>` per page; skip-link; keyboard-completable everything; visible focus; 48px touch targets (existing token); WCAG AA contrast; captions on all video, transcripts adjacent to all audio; no meaning by color alone; zoom-to-200% and 320px-width reflow as acceptance checks (mirroring the app's existing e2e bar); reduced-motion handling per §6.

## 9. Performance posture (budget enforced from Session 5)

Critical path ≤ ~100–150 KB compressed before media (SPEC §38 as engineering budget); static HTML with real content, no client framework features beyond what static export emits; explicit aspect-ratio boxes reserve all media space (zero CLS); no icon/animation libraries without justification; fonts decision deferred to Session 4 (audit §1.2 — system Noto stack vs. a deliberate webfont for first-impression typography, especially Urdu Nastaliq).

## 10. Out of scope for Session 2 (unchanged from SPEC)

No wireframes (Session 3), no design tokens/visual system (Session 4), no `apps/marketing-web` (Session 5), no infrastructure (Session 6), no production copy implementation (Session 7), no media (Sessions 8–9), no lead backend (Session 10), no analytics (Session 11).
