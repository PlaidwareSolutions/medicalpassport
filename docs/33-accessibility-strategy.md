# 33 — Accessibility Strategy

Design target: **an older adult with limited smartphone experience** (spec §18), plus users with low literacy, low vision, motor difficulties, and screen-reader users. Baseline standard: **WCAG 2.1 AA** across all patient and admin surfaces.

## Interaction and layout rules

- Touch targets ≥ 48×48 dp with ≥ 8 dp spacing; thumb-reachable bottom navigation; portrait-first.
- One primary action per screen; strong visual hierarchy; progressive disclosure.
- Large default type (16 px body minimum), scalable to 200% without loss of function; layouts tested at 320 px width.
- High contrast (≥ 4.5:1 text, ≥ 3:1 UI components); medication colors only as **secondary** cues, never the sole differentiator.
- Icons always paired with text labels.
- Minimal typing: pickers, chips, voice input; free text only where unavoidable (names, notes).
- Confirmation screens for consequential actions; **undo** where reversible; clear plain-language errors.
- Reduced-motion option honored (`prefers-reduced-motion`); no essential information conveyed by animation.
- Keyboard navigation complete on desktop; visible focus indicators.
- Safe-area insets respected in standalone PWA mode.

## Low-literacy and language support

- Plain language (~5th-grade level) in en/hi/te/ur; approved medical translations only ([11](11-medication-knowledge-strategy.md)).
- **Text-to-speech on every clinical content surface** (medication explanations, warnings, instructions) with per-locale voice detection and server-audio fallback ([32](32-browser-capability-and-fallback-matrix.md)).
- Urdu RTL fully supported (logical CSS properties throughout `packages/ui-web`; no hardcoded left/right).
- Numerals, dates, and dose patterns localized (1-0-1 grid shown visually: sun/plate/moon icons + text). **Built on the medicines list (screens 9/10)**: `DoseVisual` draws the form and per-dose quantity, then a sun/plate/moon row per slot, each glyph paired with its own visible label. Two honesty rules are enforced in `packages/medication-terminology/src/dose-visual.ts` and unit-tested: the time row is drawn only for frequencies that genuinely repeat daily (WEEKLY/FORTNIGHTLY/MONTHLY are excluded even though `proposeSlots` offers them a morning slot — the *days* come from the start date, which a list tile doesn't have), and when a pattern's slots differ (`2-0-1`) the single headline dose is suppressed and the amount moves into each slot, since one number would misstate at least one of them. **Numerals themselves are still Western digits** — localizing them only in the new row would put two digit systems in one tile, so both call sites move together or neither does.
- Browser-permission education screens explain in plain language before any OS prompt (screen 38).

## Screen-reader support

- Semantic HTML first; ARIA only where semantics fall short.
- Every control labeled; every status banner an ARIA live region (offline/sync/reminder states announced politely).
- Timeline and medication cards navigable as lists with meaningful accessible names ("Metformin, 500 milligrams, one tablet, after breakfast, due 8 AM, not yet taken").
- OTP countdowns, upload progress, and processing status announced via `aria-live="polite"`.
- Warnings (duplicate/interaction) use `role="alert"` on first render only, then remain navigable content.

## Engineering enforcement

| Layer | Mechanism |
|---|---|
| Design tokens | Contrast-validated palette, spacing/size scales encoding the 48 dp minimum (`packages/design-tokens`) |
| Component library | `packages/ui-web` components accessible by construction (labels required by props, focus management built in) |
| Lint | `eslint-plugin-jsx-a11y` error-level in CI |
| Automated tests | axe-core checks per screen in Playwright suite; zero serious/critical violations gate merges |
| Manual passes | Per-release: TalkBack (Chrome Android), VoiceOver (Safari iOS), 200% zoom, keyboard-only desktop, Urdu RTL sweep |
| Release gate | Accessibility item in [29-production-readiness-checklist](29-production-readiness-checklist.md); native phases require TalkBack/VoiceOver parity ([08](08-native-mobile-roadmap.md)) |

## Acceptance criteria (every release)

1. axe: no serious/critical violations on all 41 screens.
2. Screen-reader walkthrough completes onboarding → add medication → record dose unaided.
3. All flows completable at 200% text zoom and 320 px width.
4. All four locales render without truncation/overlap; Urdu RTL correct.
5. Every clinical warning readable aloud via TTS or fallback.
6. Reduced-motion verified; no flashing content (seizure safety).
