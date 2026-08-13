# Session 13 — Owner Rulings (Localization)

**2026-08-13.** Authoritative record of the owner's rulings on the four Session-13 decisions (recorded here, not in the peer-owned `01-decisions.md`; merge into the OD-LP register once that concurrent edit lands).

## Locale status framing (owner directive)
Hindi / Telugu / Urdu marketing are now described as:
> **Implementation complete; translation candidates complete; publication pending professional review.**
Not "localization unfinished." The localization *platform* is essentially done; what remains is editorial approval.

## 1. Native-language review — **review all three (approved)**
Commission professional/native review for Hindi, Telugu, and Urdu **independently** (no language gated on another; feedback by stable string ID). Tell reviewers: for the security/medical-boundary strings — **meaning accuracy takes priority over stylistic elegance** — especially sharing/revocation, interaction-negative (`faq.a6`), offline-reminder (`offline.honest`), and the medical-boundary `trust.not_*`. Urdu review covers **both language quality and RTL visual layout**.

## 2. Locale launch policy — **publish independently (approved)**
A locale may enter `PUBLISHED_LOCALES` once **that specific locale** has passed native-language review, claim-parity review, and final visual/accessibility verification. Do not hold one language for another. English production launch remains independent of all three. (This is exactly the implemented architecture.)

## 3. Marketing → app language handoff — **deferred, with a pre-publication requirement**
No patient-web change now — current behavior (app uses its own stored/onboarding language) is acceptable while `/hi/ /te/ /ur/` are staging-only review routes.

**Before the first non-English locale is published**, implement a reviewed handoff contract, e.g. `https://app.medidocs.app/?src=website&lang=te`, where:
- `lang` accepts only `en | hi | te | ur`; invalid values are ignored;
- `src=website` attribution is unchanged;
- the locale is applied safely to the app/onboarding experience;
- an existing user's **deliberate stored language preference is not unexpectedly overwritten** (precedence designed at implementation time).

## 4. `/for-clinics/` — **English-only V1 (approved)**
Different audience, adds security-sensitive sharing terminology, not needed to prove the multilingual patient proposition. No hidden professional translations yet; revisit after real professional adoption shows which languages matter.

## Next
Session 14 — Accessibility + Performance Hardening — proceeds in parallel with native-language review (reviewers work against the stable translation package). See [accessibility-performance-audit.md](accessibility-performance-audit.md).
