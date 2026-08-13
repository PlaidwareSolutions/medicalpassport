# Release Candidate Manifest — MediDocs Marketing (English Launch)

**Session 18 · 2026-08-13 · The frozen engineering release candidate.**

> **A release candidate is not a production launch.** This RC contains technically complete code **including** legal-review placeholders and **disabled** production integrations. It **cannot** be deployed publicly until governance and production-provisioning gates are deliberately cleared. That is intentional.

## Identity
- **RC name:** `medidocs-marketing-rc1`
- **Reference:** annotated git tag `medidocs-marketing-rc1` → the frozen commit on branch `foundation` (exact SHA recorded at tag creation / in the Session-18 final report).
- **Branch:** `foundation`
- **Date:** 2026-08-13

## Component versions
| Component | Version |
|---|---|
| marketing-web | 0.1.0 |
| patient-web | 0.1.0 |
| admin-web | 0.1.0 |
| api | 0.1.0 |
| cron | 0.1.0 |
| Next.js | 15.5.21 (security-patched) |
| React | 19.x |
| Node (project target) | 22.x |
| pnpm | 9.15.9 (pinned via `packageManager`) |

## Included capabilities (English launch)
Marketing static site (`/`, `/for-clinics/`, `/privacy/`, `/terms/`); real product media; Stage-7 patient-controlled sharing; professional lead capture (strict schema, Turnstile fail-closed, rate-limited); patient PWA (medicine record, schedule, offline, read-aloud, caregiver scopes, child/dependent V1, sharing); marketing→app locale handoff (dormant); Web-Analytics beacon (token-gated); account-erasure mechanism; backup 90-day retention (enforced); professional-lead 24-month retention (implemented).

## Publication scope
**English only.** `PUBLISHED_LOCALES = ["en"]`. Production build emits en-only; no `/hi /te /ur`, no draft-locale sitemap/hreflang.

## Deferred editorial locales
**hi / te / ur: IMPLEMENTATION + TRANSLATION CANDIDATES COMPLETE — PROFESSIONAL REVIEW PENDING.** Live on staging (noindexed) for review only.

## Technical verification summary (Session 18)
- Typechecks 7/7; builds (marketing staging+production, patient, api, admin, cron) all pass.
- Unit tests: cron 13/13, patient 21/21. API 41 env-independent pass; DB/e2e suites CI-validated (live stack).
- Accessibility: **axe 0 violations across all 7 routes**. Performance: First Load JS 104 KB, CLS 0, Slow-4G LCP ~770 ms (hero H1). 
- Security: next 15.5.21; no criticals; no committed secrets; client bundle public-config only.
- Guards: check-locales PASS, check-claims PASS, check-legal **BLOCK**, check-launch **NO-GO** (governance/provisioning only).
- Backup lifecycle enforced + remotely verified + fetch smoke; sharing analytics isolation clean (P0); CORS denies prod apex.

## Known accepted residual risks
1. **Build-time transitive audit highs** (`sharp`, `postcss`, `brace-expansion`, `nanoid`) via `next`/`postcss` — not runtime-reachable on the public surface (`next/image` unused; marketing is static export).
2. **No self-service erasure UI** — V1 uses an executable, tested manual erasure process. **POST-LAUNCH PRODUCT ENHANCEMENT.**
3. **No lead follow-up UI** — `lastInteractionAt` supports future interaction tracking, but V1 records only submission, so the effective retention clock is submission time until an operational workflow updates it. Non-blocking.
4. **`cleanup-professional-leads` cron not yet operationally scheduled** — deferred because a full prod IaC apply would also apply the prohibited production marketing CORS; non-urgent (nothing deletable for 24 months). Deployment-state item, not an engineering gap.

## Governance blockers — **DEFERRED BY OWNER UNTIL AFTER ENGINEERING COMPLETION**
Registered legal entity · counsel approval (OD-LP-6) · governing law/venue · public mailboxes (OD-LP-7) · named erasure operator · native-language professional review. **Not engineering incompleteness.**

## External provisioning pending — **NOT STARTED BY DESIGN**
Production Turnstile widget/secret/hostname · production Web Analytics site/token · production marketing API CORS (`medidocs.app`) · apex `medidocs.app` · `www` redirect · indexability enablement.

## Reproducibility
- Node 22.x (project target); pnpm 9.15.9 (`packageManager`-pinned); Next 15.5.21; `pnpm-lock.yaml` frozen at the RC commit.
- Build: `pnpm --filter @medpass/marketing-web build:production` (with production env values supplied at build time — see runbook Phase 3). Staging preview: `deploy:staging`.
- No external secret values are frozen in this manifest or the RC.

## Rollback / runbook references
- [production-launch-runbook.md](production-launch-runbook.md) — ordered, reversible cutover (Phases 0–13), smoke matrix, rollback + triggers, observability, first-15min/1h/24h.
- [go-no-go.md](go-no-go.md) — three-layer decision.
- [engineering-completion-ledger.md](engineering-completion-ledger.md) — area-by-area technical state.

## Overall state
```
ENGINEERING: COMPLETE (with accepted non-blocking residuals)
RELEASE CANDIDATE: FROZEN (medidocs-marketing-rc1)
GOVERNANCE: DEFERRED / OPEN
PRODUCTION PROVISIONING: NOT STARTED
CUTOVER: NO-GO UNTIL GOVERNANCE + PROVISIONING
```
