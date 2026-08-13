# Accessibility & Performance Audit — Marketing Site (Session 14)

**2026-08-13.** Audited **against WCAG 2.2 Level AA** as the target. This is an internal engineering audit — **it is not a claim of WCAG conformance** and no such claim is made publicly. Measurements labelled *(lab)* are single cold loads via Playwright/Chromium on staging and are **not** production field data (Core Web Vitals are field-p75 metrics).

## Scope
Route families audited: `/`, `/for-clinics/`, `/privacy/`, `/terms/`, `/hi/`, `/te/`, `/ur/`. Interactive pieces: sticky CTA, locale selector, product media (video/poster/placeholder ladder), audio control, lead form + **real Turnstile**, FAQ, legal-page TOC, RTL navigation.

## Method
- **Automated:** axe-core 4.12 via `@axe-core/playwright`, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, at 390px on all 7 routes.
- **Programmatic manual:** keyboard tab-through + focus-obscured-by-sticky (2.4.11), target sizes (2.5.8), reflow/overflow at 320/390/1280, RTL/bidi, anchor-jump offset, reduced-motion/Save-Data media behaviour, asset-failure resilience.
- **Performance:** cold-load timing, LCP/CLS (PerformanceObserver, lab), per-route JS/media/font transfer, Slow-4G throttled pass, all-media-blocked pass.

## Headline result
- **axe WCAG 2.2 AA: 0 violations across all 7 routes** (before and after fixes).
- **No P0 launch blockers found** — the "Create my Medicine Passport" CTA and the professional lead form are keyboard-reachable, correctly labelled, and completable on every route.
- All P1/P2 findings below were **fixed and re-verified this session**.

## Findings (classified, all resolved)

| ID | Finding | WCAG / metric | Severity | Status |
|---|---|---|---|---|
| A11Y-1 | **CLS 0.20–0.335** on `/`, `/hi/`, `/te/`, `/ur/`, `/for-clinics/` — the hero `ProductMedia` img→video swap collapsed its box for a frame, and (on `/for-clinics/`) the sticky-CTA appeared on mount | CWV CLS (≤0.1) | **P1** | **Fixed** → CLS **0.000** on `/` and `/for-clinics/`. Media now uses an outer aspect-ratio container with the img/video absolutely filling it (swap can't reflow); `/for-clinics/` got a hero sentinel so the sticky CTA reveals on scroll (user input, CLS-excluded). |
| A11Y-2 | Lead-form **consent checkbox 22×22 px** (< 24×24) | 2.5.8 Target Size (AA) | **P1** | **Fixed** → 24×24. |
| A11Y-3 | **No `scroll-padding-top`** — keyboard focus / anchor jumps could land under the sticky header | 2.4.11 Focus Not Obscured (AA) | **P1** (hardening) | **Fixed** → `html{scroll-padding-top:6rem}`; verified `#s2-problem` jump lands at 96px, below the 89px header. Redundant per-section `scroll-margin` removed. |
| A11Y-4 | Text links "See how it works", bridge/clinics secondary at **20–21px height** (< 24) | 2.5.8 (AA); likely exempt via spacing/inline, fixed for certainty | **P2** | **Fixed** → `display:inline-block; padding-block:4px` (≥28px target). |
| PERF-1 | **Slow-4G LCP ~4.3–4.8s (lab)** — hero media dominates transfer (~0.5 MB media on `/`) | CWV LCP (≤2.5s, field) | **P2 / watch** | Not a defect; lab-only. Below-fold media already lazy-loads; hero poster is the LCP and is the only eager asset. **Recommendation:** verify the shipped hero poster is compressed; consider a lighter LCP image. Field p75 required for a real verdict. |

## Verified clean (no defect)
- **axe:** 0 violations (color-contrast, names/roles/values, landmarks, image alts, form labels, ARIA — all pass on rendered pages, including the real Turnstile region and the RTL Urdu page).
- **Focus visibility (2.4.7):** global `:focus-visible{outline:2px …}`; `.on-primary` white variant; skip link and locale summary have focus styles.
- **Contrast (1.4.3):** axe checks actual computed colors against 4.5:1 / 3:1 — 0 failures, so the design tokens meet AA.
- **Reflow (1.4.10):** 0 horizontal overflow at 320 / 390 / 1280 px on all 7 routes. (400% zoom ≈ 320 CSS px; 200% ≈ 640, between tested widths.)
- **Headings:** exactly one `<main> h1` per route; section `h2`s.
- **RTL/bidi (Urdu):** `<html dir="rtl">`; embedded Latin (`Medicine Passport`, `QR`, numerals) isolated correctly by the bidi algorithm; switcher at inline-start; no mirrored/malformed text; **no Nastaliq webfont** (system/Noto stack).
- **Reduced motion / Save-Data:** `ProductMedia` skips autoplay and shows the poster under `prefers-reduced-motion` or `saveData`; `AudioSample` never autoplays (`preload="none"`); CSS `@media (prefers-reduced-motion: reduce)` suppresses transitions/animation.
- **Locale selector:** native `<details>` — keyboard-accessible, opens with 4 language links, `aria-current` on the current locale, works at 320px and under RTL, static navigation (no client dictionary).
- **Asset-failure resilience:** with **all media blocked**, the page renders with CLS=0, no horizontal overflow, and no page errors — the reserved box holds and the video→poster→placeholder ladder degrades gracefully.
- **Slow network:** loads and remains usable on Slow-4G (lab); text/CTA are not blocked on media.

## Performance baseline (lab — not field data)
| Route | Load | LCP | CLS (after fix) | media | font | JS budget |
|---|---|---|---|---|---|---|
| `/` | ~0.27s | ~0.25s | **0.000** | ~0.5 MB | **0** | 104 KB First Load (S13 baseline) |
| `/hi/ /te/ /ur/` | ~0.3–0.5s | ~0.25–0.45s | **0.00** | ~0.5 MB | **0** | 104 KB |
| `/for-clinics/` | ~0.22s | ~0.22s | **0.000** | ~0.1 MB | **0** | 111 KB |

**No marketing webfont** (font transfer = 0 KB) — the §62 expectation holds. First-Load-JS regression baseline (S13): `/` and locales 104 KB, `/for-clinics/` 111 KB — unchanged by this session.

**INP:** not measurable in a single lab load (INP is a field metric of real interactions). Interactive controls are lightweight (native `<details>`, server-rendered links, one small client sticky-CTA), so INP is expected good — to be confirmed with field data post-launch.

## Launch impact
No accessibility or performance **launch blocker** remains for the marketing site. The remaining P0 launch blockers are unchanged and non-engineering: legal entity, counsel approval, mailbox provisioning (OD-LP-6/7), plus native-language review of the draft locales. See [launch-governance-checklist.md](launch-governance-checklist.md).
