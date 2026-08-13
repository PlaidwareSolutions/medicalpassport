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
| **Lead retention (24-month)** | **COMPLETE (implemented + tested); cron NOT YET OPERATIONALLY SCHEDULED** — migration applied to prod; cron `cleanup-professional-leads` does not exist remotely and cannot be instantiated without a full prod IaC apply that would also apply the **prohibited** production marketing CORS (`railway.prod.ts` literal includes `medidocs.app`), so deferred by the Session-18 boundary | 9 unit tests | instantiate the cron during the provisioning phase (or with a CORS-safe targeted apply) — nothing to delete for 24 months, so non-urgent | — | cron service instantiation |
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

## Session 18 — final validation results (2026-08-13)
- **Typechecks** 7/7 packages OK. **Builds** marketing (staging + production), patient, api, admin, cron all pass. **Unit tests:** cron 13/13, patient 21/21. **API** 41 env-independent pass; 15 DB/loadEnv-gated integration tests require the live stack (CI-validated, not faked). The full e2e suites (erase-account, children-guardian, leads, sharing, sync, rate-limit, …) run in CI against the real stack.
- **Backup retention** re-verified remotely (rule present, 90-day, idempotent) + **fetch smoke** (newest backup enumerated + fetched, 959,434 B, size-intact).
- **Locale handoff** allowlist/precedence re-confirmed; still en-only in production.
- **Sharing** `/s/` third-party analytics isolation = **NONE** (P0 clean); share headers `private,no-store`+`noindex`+`DENY`.
- **Live smokes:** 7 marketing routes 200 + noindex + correct lang (Urdu RTL); patient/admin staging+prod no `x-powered-by`; APIs `postgres:ok`; CORS allows staging, denies evil + **prod apex** (marketing CORS not applied).
- **Guards:** check-locales PASS, check-claims PASS, check-legal **BLOCK** (14 markers), check-launch **NO-GO** on governance/provisioning only (no obsolete engineering failures).
- **Security:** next 15.5.21; no criticals; no committed secrets; no `.env` tracked; client bundle public-config only; assets no listing.
- **Accessibility:** axe **0 violations across all 7 routes** after a minimal fix — the `.mkt-reveal` scroll animation dropped text opacity mid-transition (transient axe color-contrast false-positive on `/ur`, reduced-motion-exempt); changed to a **transform-only** rise. Deterministic 0/7.
- **Performance:** First Load JS 104 KB (`/`) — unchanged; CLS 0; Slow-4G LCP ~770 ms (hero H1 text) per Session 16 — no regression (CSS-only change).
- **DNS** unchanged since Session 16 (apex/www unconfigured; no MX to disturb).

## No known engineering gaps
No landing-page-program engineering **implementation** gap remains. The single deployment-state item — instantiating the `cleanup-professional-leads` cron **service** — is deferred by the Session-18 boundary (a full IaC apply would apply prohibited prod marketing CORS), not an engineering incompleteness, and is non-urgent (nothing to delete for 24 months). Open items are **governance** (legal entity, counsel, mailboxes, erasure operator, native-language review — DEFERRED by owner) and **production provisioning** (Turnstile/WA/CORS/apex/www — NOT STARTED by instruction).
