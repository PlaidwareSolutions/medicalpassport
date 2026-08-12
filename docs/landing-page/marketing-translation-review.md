# Marketing Translation Review Package (Session 13)

**2026-08-13.** For native-language reviewers of the Hindi / Telugu / Urdu marketing candidates. **Every locale is DRAFT — PROFESSIONAL REVIEW REQUIRED.** Nothing here is published: draft locales render only on staging (noindexed) for review.

## How to review (no source code needed)
1. Open the draft page for your language:
   - Hindi → https://staging.medidocs.app/hi/
   - Telugu → https://staging.medidocs.app/te/
   - Urdu → https://staging.medidocs.app/ur/ (right-to-left)
2. Read top to bottom. Every string has a stable **string ID** (e.g. `hero.h1`, `share.body`, `faq.a6`).
3. Give feedback **by string ID + language**, e.g. *"`share.chip_revocable` / Telugu — change X to Y"* (§57). No need to edit code.
4. Feedback goes to the source dictionary (`apps/marketing-web/lib/dictionaries/{hi,te,ur}.ts`), then re-checked for claim parity, rebuilt, re-reviewed, and only then marked REVIEWED (§58).

## Status model (§4)
`DRAFT` → `PROFESSIONAL REVIEW REQUIRED` → `REVIEWED` → `PUBLISHED`. A locale is added to `PUBLISHED_LOCALES` (and thus emitted in production) only at REVIEWED+. Machine-drafted ≠ reviewed.

| Locale | Implementation | Translation | Review | Production |
|---|---|---|---|---|
| English | complete (canonical source) | n/a | n/a | **published** |
| Hindi | complete route | candidate (126/135 strings) | **required** | not published |
| Telugu | complete route | candidate (126/135 strings) | **required** | not published |
| Urdu | complete route (+ RTL) | candidate (126/135 strings) | **required** (translation + RTL/layout) | not published |

*(135 = translatable homepage strings; the 9 not counted are brand names, language autonyms, and demo values, which are intentionally identical across locales.)*

## Reviewer roles (§39)
- **Hindi** — professional/native review required.
- **Telugu** — professional/native review required.
- **Urdu** — professional/native review **and** RTL/layout review required.
- For the **security/sharing** and **trust "does not"** strings below, prefer a reviewer comfortable with healthcare terminology.
Do not mark anything "reviewed" without an actual named human review.

## Claim-parity — MUST-MATCH strings (highest scrutiny)
A translation must never be **stronger or weaker** than the English source (§12). These are the strings most at risk. `[SECURITY WORDING — PROFESSIONAL TRANSLATION REVIEW REQUIRED]` is flagged where noted (§35).

| String ID | English (canonical) | Gate / rule | Reviewer note |
|---|---|---|---|
| `free.h2` / `hero.chip_free` | "free for **all patients**" | Business-approved; must **not** become "everything free forever" (§12) | Confirm scope = patients' own record only |
| `free.body` | "…free for all patients to **create, maintain and access**…" | Same | Do not add "share" or "forever" |
| `share.body` | "…You can **stop the link at any time**, and see when it was opened." | **[SECURITY WORDING]** stop *future* access only | Must NOT imply erasing what the doctor already saw/downloaded |
| `share.chip_revocable` | "Stop the link any time" | **[SECURITY WORDING]** | "stop future access via the link" |
| `share.chip_expires` | "You set how long it lasts" | time-limited, patient-set | — |
| `faq.a6` | "No. …does not check drug interactions and never declares any combination safe." | Clinical-gated; keep the **clear "No"** (§33) | Must not soften into "maybe/ask us" |
| `trust.not_1..5` | "does not diagnose or prescribe" … "does not replace doctors" | Medical boundary — must stay **just as strong** (§34) | No hedging; keep the negative explicit |
| `offline.honest` | "Reminders need a connection." | Honest limitation (§36) | Must remain; don't imply full offline |
| `care.body` / `care.tagline` | caregiver access is "granted, bounded, visible — and removable" | Patient-controlled; caregiver ≠ guardian (§37) | Don't introduce legal-guardian terms |

## Section index (S1–S14) — string IDs to review
Candidates live in the per-locale dictionaries; review on the live draft pages by these IDs.

- **S1 Hero:** `hero.h1`, `hero.sub`, `hero.chip_free`, `hero.chip_no_install`, `hero.chip_languages`, `hero.cta`, `hero.secondary`
- **S2 Problem:** `problem.h2`, `problem.a_title/a_body`, `problem.b_title/b_body`, `problem.c_title/c_body`, `problem.thesis`, `problem.reveal`
- **S3 Reveal:** `reveal.h2`, `reveal.body`, `reveal.card_caption`, `reveal.f_*` (labels translated; values `Glucomet 500` etc. stay Latin)
- **S4 Know:** `know.h2/body`, `know.chip_photo/search/manual`
- **S5 Remember:** `remember.h2/body`, `remember.chip_timeline/reminders/refills`
- **S6 Accessibility:** `access.h2/sub/body`, `access.lang_*` (autonyms), `access.listen`, `access.audio_*`
- **S7 Offline:** `offline.h2/body`, **`offline.honest`** (claim-critical)
- **S8 Caregiving:** `care.h2/body/tagline/cta`
- **S9 Sharing:** `share.h2/body`, `share.chip_*` (claim-critical)
- **S10 Free:** `free.h2/body`, `free.chip_no_ads/no_paywall` (claim-critical)
- **S11 Trust:** `trust.h2`, `trust.does_1..4`, **`trust.not_1..5`** (claim-critical)
- **S12 Bridge:** `bridge.h2/body/cta`
- **S13 FAQ:** `faq.q1..q10` / `faq.a1..a10` (**`faq.a6`** claim-critical)
- **S14 Final CTA:** `final.h2/sub/qr`
- **Chrome:** `brand.*`, `nav.*`, `header.cta*`, `footer.*`, `review.banner`, `notfound.*`

## Not translated (by design)
- `/for-clinics/` (the `clinics.*` and `lead.*` strings) — English-only V1 (§16). Not on any translated route.
- `/privacy/` and `/terms/` — remain **English DRAFT**; localized pages link to them marked "(English)" (§51). No translated legal policy exists.
- Product video/app footage and audio — remain English; final non-English marketing recordings are review-gated and deferred (§25/§26).
