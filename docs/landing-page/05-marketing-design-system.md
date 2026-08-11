# Landing Page — Session 4: Marketing Design System Extension

**Date:** 2026-08-11 · **Status:** APPROVED at the Session 4 gate (2026-08-11) with four rulings recorded in [01-decisions.md](01-decisions.md) §"Session 4 gate rulings": warm paper ground approved as a semantic token; illustration accents approved with boundaries (illustration-only, green stays the sole action hue, illustrations reviewed as one family); MP monogram partially approved (favicon/small-icon only — OG imagery prefers lockup + authentic product UI); Nastaliq deferred.

**Implementation principles (owner-added at the gate):**
1. Marketing-specific values — page ground, illustration accents, surface colors, content widths, section spacing — are **semantic tokens**, never hardcoded through components.
2. Reuse the product's visual language where appropriate, but **do not force the marketing site to look like another application screen**.
3. Marketing may use more editorial typography, whitespace, storytelling layouts and illustration than the app — while preserving recognizable MediDocs colors, controls, and product imagery.
Foundations: `packages/design-tokens` (the application's tokens are the baseline; marketing adds only what the page format needs), [wireframes.md](wireframes.md) patterns P1–P4, [04-content-spec.md](04-content-spec.md). **Visual evidence:** representative mockups accompany this document at `mockups/session4-visual-direction.html` (published for review as an artifact) — judge the aesthetic there, not from prose.

All contrast figures in §3 are **measured** (WCAG 2.x relative-luminance computation run this session), not asserted.

---

## 1. Brand expression

- **Product identity:** *Medicine Passport* is the name users see and the voice of every product sentence. **Endorsement:** *by MediDocs* appears directly beneath or after the wordmark at ~0.5× size, muted color, never bolder than the product name. Footer and legal lines speak as "MediDocs".
- **Wordmark:** typeset, not drawn — the system type stack at weight 800, `--mkt-primary` on light surfaces, white on the S10 panel. **No logo mark is commissioned** (OD-LP-3: branding is provisional pending trademark clearance; nothing irreversible). Interim favicon/OG tile: a plain "MP" monogram, green tile, white letters — explicitly provisional, flagged for the gate.
- **Lockup behavior:** minimum width 132px (below that, drop the endorsement line, keep "Medicine Passport"); clear space = cap-height of "M" on all sides; never letter-spaced, never all-caps, never on photographs.
- **Headers:** mobile — two-line lockup left, locale chip right; desktop — lockup left, quiet nav + locale chip + CTA right (per wireframes §1.1, sticky-CTA-after-hero rule). Header background `--mkt-paper` at 96% opacity with hairline bottom border on scroll.

## 2. Visual character

**Target:** calm, human, trustworthy, accessible, contemporary; recognizably at home for Indian patients and families. The page should feel like a well-set book with living product proof inside it — generous whitespace, warm paper ground, one confident green, real app UI as the hero imagery, warm flat illustration for the human stories.

**Explicitly avoided:** generic SaaS template styling (three-column icon grids, floating gradient blobs), "AI neon"/dark-glow aesthetics, heavy gradients, glassmorphism, hospital-corporate clichés (stethoscope stock photos, blue-white sterility), decorative motion competing with content, photorealistic medical stock photography, testimonial-style imagery of any kind (MKT-090).

## 3. Color system

Anchored on the product green `#0f6b54` (reused as-is — contrast testing below confirms no variation is needed). No large marketing palette: one green, warm neutrals, ink, plus two illustration-only support colors.

| Token | Value | Role |
|---|---|---|
| `--mkt-primary` | `#0f6b54` | Brand anchor: CTA fill, links, wordmark, S10 panel ground |
| `--mkt-primary-hover` | `#0c5745` | CTA hover; also the focus-ring color on light surfaces |
| `--mkt-primary-pressed` | `#094636` | CTA pressed |
| `--mkt-primary-soft` | `#e3f2ed` | Tinted surfaces: chips, skeletons, story-card grounds (existing app token) |
| `--mkt-ink` | `#1a1f1d` | Headings and body text |
| `--mkt-muted` | `#52605b` | Supporting text, endorsement line, captions on light |
| `--mkt-paper` | `#fbfaf7` | Page background (warm off-white — the "calm/human" ground; **gate judgment: see mockups**) |
| `--mkt-surface` | `#ffffff` | Cards, form fields |
| `--mkt-hairline` | `#d8ded9` | Decorative separators only (not relied on for meaning) |
| `--mkt-border-control` | `#8a8e8c` | Form-control borders — the app's existing border token, kept because it passes non-text 3:1 |
| `--mkt-panel-chip` | `rgba(255,255,255,.14)` | Chip fill on the S10 green panel (composited `#31806c`) |
| `--mkt-caption` | `#22302b` | Caption pill behind video captions |
| Semantics | reuse app tokens | danger/warning/info/success pairs from `packages/design-tokens` — marketing needs them only for form validation |
| Illustration-only | `#b65c32` clay, `#e8dcc7` sand | Never used for UI, text, or meaning — warmth in illustrations only |

**S10 Free panel treatment:** full-bleed `--mkt-primary` ground, white text, `--mkt-panel-chip` chips with white text, **inverted CTA** (white fill, `--mkt-primary` text) — the page's only full-bleed color moment (approved wireframe rule).

**Measured contrast (WCAG 2.x):**

| Pair | Ratio | Verdict |
|---|---|---|
| Ink on paper / on white / on soft | 16.00 / 16.70 / 14.46 | AAA |
| Muted on paper / on white | 6.32 / 6.60 | AA (normal text) |
| White on primary (CTA, S10) | 6.46 | AA |
| White on primary-hover / -pressed | 8.52 / 10.82 | AAA |
| Primary on paper (links) / on white (inverted CTA) | 6.19 / 6.46 | AA |
| White on S10 chip surface (`#31806c` composite) | 4.74 | AA |
| White on caption pill | 13.76 | AAA |
| Control border on paper / on white (non-text 1.4.11) | 3.18 / 3.32 | ≥3:1 pass |
| Focus ring `#0c5745` on paper | 8.16 | pass |

Hairline-vs-paper and chip-fill-vs-paper measure below 3:1 **by design** — both are decorative; nothing meaningful is conveyed by those boundaries alone (text does the work).

**Focus is dual-context:** 2px ring, `#0c5745` on light surfaces; **white** on the S10 panel and any green ground (6.46:1 there); always offset 2px so it never melts into fills.

## 4. Typography

**Stack:** reuse the application's system/Noto strategy verbatim — no marketing webfont for distinctiveness (ruling). English critical path loads **zero font bytes**.

| Style | Mobile (≤767px) | Desktop | Weight / notes |
|---|---|---|---|
| Display (S1 H1) | 32px / 1.15 | 54px / 1.08 | 800, letter-spacing −0.015em, max 3 lines |
| H2 (section) | 26px / 1.2 | 36px / 1.15 | 750 |
| H3 (cards, FAQ Q) | 20px / 1.3 | 22px / 1.3 | 700 |
| H4 (tile titles) | 17px / 1.4 | 18px / 1.4 | 700 |
| Body | 17px / 1.6 | 18px / 1.6 | 400; never below the app's 16px floor |
| Small/supporting | 14px / 1.5 | 14px / 1.5 | 500; **14px is the absolute minimum anywhere** |
| Chips | 14px | 15px | 600 |
| CTA | 17px | 18px | 700; no all-caps |
| FAQ answer | body | body | max 3 lines per the approved wireframe constraint |

Line lengths: headlines ≤ 24ch (display) / 34ch (H2); body ≤ 65ch (`max-width: 720px` text column). All sizes in rem; **200% zoom** works by rem scaling with no fixed-height text containers and no clipping (acceptance check, §10).

**Urdu / Nastaliq — the tradeoff, documented (final inclusion deferred until `/ur/` approaches publication):**
- *For Nastaliq* (e.g., Noto Nastaliq Urdu): it is how Urdu is actually read and printed; naskh fallbacks (Geeza Pro on iOS/macOS, Noto Naskh Arabic on Android) render Urdu legibly but visibly "Arabic-styled," which undercuts S6's "in your language" promise for exactly the audience it exists for.
- *Against:* ~250–400KB font payload; dramatically taller vertical metrics (line-height needs ~1.9–2.1 vs 1.6, ascender/descender overflow risks in buttons and chips); slower first paint on the cheapest devices.
- **Ruling applied:** if adopted, it is **loaded only on the `/ur/` route** (`font-display: swap`, subset, preloaded there only) — the English/hi/te critical paths never carry it; under Save-Data the fallback naskh stack is used instead. Layout rules for `/ur/` regardless of font: line-height 2.0 for body, button/chip vertical padding +4px, no letter-spacing ever (breaks joining), digits in Latin numerals per app convention, mixed Latin tokens (brand names, "QR") isolated with `bdi`/`dir="ltr"` spans, RTL mirroring per §10.

## 5. Spacing and layout

- **Scale:** app base 4/8/16/24/32 + marketing extensions 48/64/96/128 (8px grid throughout).
- **Containers:** text column 720px; wide container 1140px; full-bleed bands span the viewport with inner containers. Gutters: 16px @320, 20px mobile, 32px ≥768.
- **Section rhythm:** vertical padding 64px mobile / 96px desktop; statement panels (P3) 80/128. Consecutive sections never double-pad (single shared gap).
- **No forced 100vh:** the wireframe's "~100vh hero" is implemented as `min-height: min(92svh, 760px)` with natural content height winning — sections take the height their content needs; the vh figures in wireframes are pacing guidance, not constraints. *(This supersedes a literal reading of the wireframe heights — recorded as the one Session 3 → Session 4 reconciliation, not a conflict.)*
- **P1 hero split:** 55/45, 48px gap, collapses <900px to the mobile stack.
- **P2 media row:** 12-col grid — media 5 cols (phone frame max-height 640px, vertically centered), copy 7 cols, 64px gap, sides alternate, collapses <900px (copy first, media second — reading order preserved).
- **P3 statement panel:** full-bleed band, inner content centered, 720px max.
- **P4 columns:** story cards 3-across ≥1100px (stagger below), trust lists 2-col ≥900px, FAQ single 720px column always.

Pacing rule: whitespace serves the narrative — S12/S14 stay thin bands (24/32px inner padding beyond rhythm); no section is padded to fake weight.

## 6. Components (state behavior)

- **Primary CTA:** `--mkt-primary` fill, white text, 12px radius, 48px min-height, full-width ≤480px. Hover `-hover`, pressed `-pressed` (+1px translate-y), focus dual-context ring, disabled never used on marketing pages (a CTA either exists or doesn't). Inverted variant on S10 only.
- **Secondary CTA ("See how it works"):** text button, `--mkt-primary`, underline on hover/focus, ↓ glyph allowed; never outlined-button styling (avoids two competing buttons).
- **Text links:** `--mkt-primary`, underlined by default (body links always underlined — accessibility over aesthetics), hover darkens.
- **Navigation:** per §1; quiet links `--mkt-muted` → ink on hover; current-page link not shown as link.
- **Locale chip/switcher:** static "EN" chip (hairline border, 14px) until ≥2 published locales; then a button opening a plain list menu — native-script labels (`LOCALE_NAMES`), current locale checked, full keyboard support. Never mixed with the "App languages:" trust chip, which is a plain non-interactive chip in the hero chip row.
- **Trust/value chips:** `--mkt-primary-soft` fill, ink text, 999px radius, 8×14px padding; wrap freely; never clickable (no chip-that-looks-like-button ambiguity). S10 variant per §3.
- **Story cards (S2):** `--mkt-surface` card, 16px radius, hairline border, illustration (3:2) top, H3 + ≤3-line copy, listen button bottom-left; no shadow at rest, 1dp shadow on hover only where a card is a link (S2 cards are not links).
- **Benefit callouts (S3 `<dl>`):** term 700-weight ink, definition muted, 2px `--mkt-primary` left rule per item.
- **Phone frame:** 1.5px `rgba(26,31,29,.16)` border, 28px radius, 8px inner padding, `--mkt-surface` matte, one soft ambient shadow (`0 12px 32px rgba(26,31,29,.10)`); **deliberately generic** — no notch, no buttons, no vendor likeness; the frame must always be quieter than the app UI inside it.
- **Video/poster container:** sits inside the phone frame; reserved `aspect-ratio: 390/780`; skeleton `--mkt-primary-soft` while loading; caption line (see §7); if video unavailable → poster; if no poster → static annotated screenshot.
- **QR card:** white card, hairline border, QR + "Scan to open on your phone" small text; desktop only (S1, S14).
- **Full-bleed statement panel (P3/S10):** per §3; content max 720px centered; chips wrap; no imagery.
- **FAQ item:** H3 question, body answer, 32px between items, hairline rule between; **no accordion** (approved).
- **Does/does-not lists (S11):** two cards; "does" list markers are ✓ in `--mkt-primary`, "does-not" markers are an en-dash in `--mkt-muted` — **wording carries the meaning, color never alone**; items are full sentences.
- **Clinic tiles (C6):** surface cards, H4 + 2-line copy, 2×2 ≥900px, stacked below. *(Gated with the professional unit.)*
- **Lead form controls (C7):** app conventions — labels above fields, 16px field text, `--mkt-border-control` 1.5px borders, focus ring per §3, error text in words below the field in the app's danger token + icon, consent checkbox 24px with plain-language label, submit = primary CTA. *(Gated with the professional unit.)*
- **Footer:** `--mkt-surface` on hairline top border; link groups per wireframe; smallest text 14px.

## 7. Product-media treatment

The **real application UI is the principal visual evidence** — everything else defers to it.

- **Device frame:** as §6 — matte, generic, quieter than its content.
- **Screenshot cropping:** crop the OS status bar; keep the app's own header; never crop mid-element; 2× asset density.
- **Video:** portrait app captures at 390×844 logical (aspect 390/780 after status-bar crop), H.264 MP4 + WebM, hero ≤15s, section demos 8–12s, loop, muted, `playsinline`, `preload="none"` below fold, play only while in viewport (pause offscreen).
- **Poster:** first *stable* frame of the flow (not a mid-transition blur); no dimming, no fake play button on autoplay clips (they are ambient proof, not click targets).
- **Captions:** every clip narrates its steps as timed captions — WebVTT rendered as a caption pill (`--mkt-caption` ground, white 14px text, 13.76:1) at the frame's lower inside edge; the same steps always exist as adjacent HTML text (SPEC §41: no video-only information).
- **Listen/play states (narration buttons):** ▶ + label at rest; playing = pause glyph + subtle 2px `--mkt-primary` left-border progress; focus ring standard; transcript = the visible adjacent text.
- **Unavailable media ladder:** video → poster → annotated screenshot → text only; each step is a build-time-known fallback, never a broken player chrome.

## 8. Illustration system

Purpose: the human situations the app UI cannot show (S2 stories, C2). Style: **flat warm minimalism** — ink (`--mkt-ink`) line work, `--mkt-primary` + clay + sand fills, paper ground; geometric-humanist figures with simplified faces (readable as *anyone*, never as a specific real patient — no testimonial ambiguity, MKT-090); Indian household/clinic contexts drawn with specificity (dupatta, steel tiffin, auto-rickshaw silhouette, ceiling fan) but zero costume clichés; no photorealism, no stock photography, no medical-horror (no giant pills, no skulls, no red alarms).

Canonical set (3:2, SVG): **A** consultation question — patient with scattered strips/papers/phone; **B** two medicine strips, different labels, same shadow *(neutral — echoes the corrected Story B wording)*; **C** two cities, parent + adult child, connected by a thin green thread; **D** train/underpass connectivity drop, phone still showing the passport. Line weight and palette identical across all four.

## 9. Motion

- Entrance/reveal: opacity + 8px translate-up, 240–320ms, ease-out, once per element, stagger ≤3 items at 60ms.
- Crossfades (S6 language strip on desktop): 200ms.
- Hover/focus: color/elevation only, 120ms; nothing moves position on hover.
- Product video: plays in viewport, pauses out of it; no scroll-scrubbing, no parallax, no looping decorative background motion.
- `prefers-reduced-motion: reduce`: all reveals/crossfades off (content simply present), autoplay video replaced by posters. **Motion never carries information absent from static content** — reveals are the same content, later.

## 10. Responsive and accessibility rules

| Width | Rules |
|---|---|
| 320px | Single column; chips wrap to 2 rows; S6 strip swipeable; gutter 16px; sticky-header short CTA label; nothing horizontal-scrolls except the deliberate S6 strip |
| 390px | Reference design width; mobile flow per wireframes §2 |
| 768px | Gutter 32px; type steps toward desktop scale; P2/P4 still stacked until 900px |
| ≥900/1100/1140px | P2 rows engage at 900, story cards 3-across at 1100, wide container caps at 1140 |

- **200% zoom:** rem-based scale, no fixed text-container heights, no clipped overflow; acceptance = every section usable at 200% on 1280px viewport.
- **Keyboard:** skip-link first; logical tab order = reading order; dual-context focus ring everywhere; FAQ/lists are plain content (no widgets to trap focus).
- **Touch:** ≥48px targets (app token), ≥8px between adjacent targets.
- **Save-Data:** posters only, no autoplay, no `/ur/` webfont, no prefetch.
- **RTL (`/ur/`):** logical properties throughout (`margin-inline`, `padding-inline`, `inset-inline`); P1/P2 mirror; chevrons/arrows flip; QR and phone frames don't mirror (content is directional-neutral); Latin tokens isolated per §4; verified against SPEC Session 13's Urdu checklist.
- **Long strings:** buttons and chips wrap (never truncate/ellipsis); `min-width: 0` on grid children; German-length test strings used in review even though launch is English.

## 11. Gated-component behavior (professional unit + clinical lines)

Per OD-LP-10 and its Session 3 addendum, gating is **build-time composition, not hiding**:

- The professional unit — S9, S12, `/for-clinics/` (all sections + lead form + its route) — is **one flag**. Off: the route is not built or emitted (no page, no sitemap entry, no nav/footer "For doctors & clinics" links anywhere — header, footer, and S11's link list each have the link *conditionally composed*, not blanked), S8's bottom rhythm meets S10's panel directly (single shared 96px gap, no residual spacing), and no anchor `#c7-lead` or `/for-clinics/` href exists in the DOM at all. On: everything appears together.
- Clinical-gated *sentences* (Story B tie-in, S5 escalation, S11 "worth asking" line, FAQ 6's capability sentence) are content-level flags inside their sections: the surrounding paragraph is written (Session 7) so it reads complete without them — no "…" stubs, no empty list items.
- The S10 "never sold" chip renders only when its business/legal approval flag is set; the chip row is designed for 2 or 3 chips (wrap layout indifferent).
- No "coming soon" placeholders of any kind (owner ruling).

---

## Decisions still requiring owner input (Session 4 gate)

1. **Warm paper vs. pure white page ground** — `#fbfaf7` is this system's single biggest "calm/human vs. clinical SaaS" move; judge it in the mockups (they render both hero variants side by side).
2. **Illustration support colors** (clay `#b65c32` / sand `#e8dcc7`, illustration-only) — approve the warmth direction before Session 8 commissions the four canonical illustrations.
3. **Interim "MP" monogram favicon/OG tile** — provisional branding; acceptable until trademark clearance, or hold OG imagery to screenshots only?
4. **Nastaliq** — already deferred by your ruling; no action now, re-raised when `/ur/` approaches publication.

## Conflicts discovered with Session 3 wireframes

Only one, resolved in place: the wireframes' per-section vh figures are treated as **pacing guidance**, not layout constraints — §5's "no forced 100vh" rule (hero `min(92svh, 760px)`, content-height sections) supersedes a literal reading. No other conflicts: all four patterns, the sticky-CTA rule, the single-locale chip, chip distinctions, and clean-seam gating carried through unchanged.

**STOP — Session 4 gate.** Next (Session 5, on approval): `apps/marketing-web` technical foundation.
