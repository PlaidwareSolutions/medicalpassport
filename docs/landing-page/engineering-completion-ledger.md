# Engineering Completion Ledger — Landing-Page Program

**Session 17 · 2026-08-13.** Objective, area-by-area technical state so Session 18 can perform final validation against a concrete checklist. Legend: **COMPLETE** = technically done + tested; **IMPLEMENTED — REVIEW PENDING** = editorial/governance gate only; **DEFERRED** = owner-postponed, not blocking development.

> The owner has sequenced **all engineering first**; legal/governance/provisioning follow. Nothing below is a production cutover.

| Area | Technical state | Tests | Remaining engineering work | Governance dependency | Production dependency |
|---|---|---|---|---|---|
| Marketing site (English) | **COMPLETE** — static export; content frozen candidate | typecheck, static export, a11y (0 axe), perf | none | Final English legal copy (counsel) | apex attach |
| Product media | **COMPLETE** — real audio/video/posters on `assets.medidocs.app`; graceful placeholder ladder | asset 200/MIME/cache checks; media-blocked a11y pass | none | — | — |
| Locales (hi/te/ur marketing) | **IMPLEMENTED — REVIEW PENDING** | key-parity checker; RTL a11y | none (routes/build gated) | Professional native review | stays en-only in prod |
| Marketing → app locale handoff | **COMPLETE** (Session 17) — `?lang=` allowlisted, precedence-correct, dormant in prod | 7 unit tests (allowlist/precedence/attribution-independence) | none | — | activates only when a locale is published |
| Sharing (Stage 7) | **COMPLETE** | Stage-7 review; live header checks | none | — | — |
| Professional lead flow | **COMPLETE** — strict schema, Turnstile fail-closed, rate-limited, server-fixed source | live strict/CORS/Turnstile regression | none | — | prod Turnstile + CORS |
| Analytics (Web Analytics) | **COMPLETE** — token-gated beacon, marketing-only, no app/admin/share spill | third-party inventory (S15) | none | — | prod WA site/token |
| Turnstile | **COMPLETE** (staging) — optional-vendor pattern both sides | live enforcement test | none | — | prod widget/secret/hostname |
| API CORS | **COMPLETE** — env-driven allowlist; prod origin staged not applied | live preflight (evil/prod/staging) | none | — | apply `medidocs.app` origin |
| Account erasure | **COMPLETE** (mechanism) — plan/execute, counts-only, synthetic-tested | e2e (3 cases) | none | **Operator name (DEFERRED by owner)** | — |
| **Backup retention (90-day)** | **COMPLETE — TECHNICALLY ENFORCED + VERIFIED** (Session 17): R2 lifecycle rule `expire-postgres-backups`, `postgres/` prefix, 90-day expiry, applied to prod `…-backups` bucket and remotely verified; idempotent ensure-cron in IaC | rule-builder unit tests; live apply + independent re-read | dev bucket self-applies on cron deploy | — | — |
| **Lead retention (24-month)** | **COMPLETE (implemented + tested)** (Session 17): `lastInteractionAt` column + backfill migration; batched idempotent cleanup cron; dry-run | 9 unit tests (cutoff/boundary/null-safe/interaction-basis) | scheduled cron **service** created on next IaC apply | — | — |
| Accessibility | **COMPLETE** — WCAG 2.2 AA target, 0 axe × routes; no public conformance claim | axe + keyboard/focus/RTL | none | — | — |
| Performance | **COMPLETE** — Slow-4G LCP ~770 ms (H1 text), CLS 0, 104 KB First Load | lab LCP/CLS/transfer | none (field p75 post-launch) | — | — |
| Security | **COMPLETE** — SEC-1/SEC-2 resolved; SEC-3 residual = build-time transitive highs only | audit + live headers + secret scan | none | — | — |
| Public claims | **COMPLETE** — truth-first; gated claims absent from emitted output | `check:claims` | none | Business/counsel wording sign-off | — |
| Legal build guard | **COMPLETE — correctly BLOCKING** | production build blocks on 14 markers | none | Resolve markers (legal) | — |
| Production preflight | **COMPLETE** — `check:launch` strict/permissive; represents all remaining external provisioning | 3-mode test | none | — | supply prod values at build |

## Dependency state (§43)
Next.js `15.5.21` (patched). Remaining `pnpm audit` highs — `sharp`, `postcss`, `brace-expansion`, `nanoid` — are all **build-toolchain transitives through `next`/`postcss`**, unchanged by Session 17 and not runtime-reachable on the public surface (`next/image` unused; marketing is a static export). Not vulnerability-free; classified.

## Feature-flag inventory (§39)
| Flag | Current | Expected prod (V1) | Changed by |
|---|---|---|---|
| `CLINICAL_CLAIMS_APPROVED` | `false` | `false` | clinical validation sign-off |
| `NEVER_SOLD_CHIP_APPROVED` | `false` | `false` | business/legal sign-off |
| `PROFESSIONAL_UNIT_ENABLED` | `true` | `true` | Stage-7 (cleared) |
| `PUBLISHED_LOCALES` | `["en"]` | `["en"]` | professional locale review |
| Legal markers (guard) | present | resolved | counsel sign-off |

## No known engineering gaps
No landing-page-program engineering implementation gap remains pending Session-18 validation. Open items are **governance** (legal entity, counsel, mailboxes, erasure operator, native-language review — all DEFERRED by owner) and **production provisioning** (Turnstile/WA/CORS/apex/www — NOT STARTED by instruction).
