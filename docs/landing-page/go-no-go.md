# Launch Go / No-Go — medidocs.app

**Session 16 · 2026-08-13.** Three independent layers must all be GREEN before cutover. Engineering readiness is **not** permission to launch.

## Overall: **NO-GO FOR CUTOVER — LAUNCH PLAN READY**

Engineering is ready; governance and production-provisioning gates remain (both deferred by instruction / pending the owner + counsel). The runbook ([production-launch-runbook.md](production-launch-runbook.md)) is complete and dry-run-validated.

> **Session 18 update (2026-08-13):** engineering is now **COMPLETE** and frozen as release candidate **`medidocs-marketing-rc1`** ([release-candidate-manifest.md](release-candidate-manifest.md)). Full-system revalidation passed (a11y 0/7 after a minimal reveal-animation fix; backup lifecycle re-verified + fetch smoke; sharing analytics isolation clean; guards legal-BLOCK / launch-NO-GO clean). One non-urgent deployment-state item remains: the `cleanup-professional-leads` cron is implemented but not yet scheduled (its IaC apply would also apply prohibited prod CORS — deferred to the provisioning phase). *Resolved in Session 19 (2026-08-13): `cron-cleanup-professional-leads` created and scheduled (`0 5 * * *`) during the prod IaC apply — see [production-soft-launch-report.md](production-soft-launch-report.md).*
>
> ```
> ENGINEERING: COMPLETE   RELEASE CANDIDATE: FROZEN
> GOVERNANCE: DEFERRED/OPEN   PRODUCTION PROVISIONING: NOT STARTED   CUTOVER: NO-GO
> ```

> **Session 19 update (2026-08-13) — two intentionally separate gates:**
>
> **Technical Production Cutover (controlled soft launch)** — **✅ LIVE.** `https://medidocs.app` is publicly reachable on the production marketing Worker (`medidocs-marketing-production`), valid TLS, **globally noindexed**, English-only, legal-draft retained. Verified: prod Turnstile renders + fail-closed lead endpoint; production API CORS authorizes the apex; exactly one WA beacon on marketing (zero on app/admin/share); `/hi /te /ur` → 404; retention crons scheduled; subdomains healthy; axe 0 violations; no staging/localhost/tracker leakage. **Only `www.medidocs.app` → apex 301 redirect remains** (needs Cloudflare Zone/Ruleset edit — dashboard; non-critical). See [production-soft-launch-report.md](production-soft-launch-report.md).
>
> **Final Public / Indexed Launch** — **NO-GO** (governance open: legal entity, counsel, mailboxes, erasure operator, native-language review). `build:production` + `check:legal` still BLOCK. This is not a contradiction with the cutover gate — they are deliberately separate; even once the soft launch is live it stays **noindexed** and legally draft.
>
> ```
> ENGINEERING: COMPLETE                 RC1: FROZEN
> PRODUCTION SOFT LAUNCH: LIVE (medidocs.app; www redirect pending)
> APEX: LIVE     WWW: pending 301
> SEARCH INDEXABILITY: OFF (by design)  GOVERNANCE: OPEN
> FINAL PUBLIC LAUNCH: NOT YET AUTHORIZED
> ```

---

## Layer 1 — Engineering GO: **YES** (with residual P2)

| Item | State | Evidence |
|---|---|---|
| SEC-1 (Next.js patch) | **PASS** | `15.5.20 → 15.5.21` (patient/admin/marketing); advisories gone; deployed staging+prod; `x-powered-by` absence confirms deploy live; apps `ready`/`postgres:ok` |
| SEC-2 (x-powered-by) | **PASS** | Absent on staging+prod patient app **and** API (was present in S15) |
| Dependency audit | **PASS (with residual)** | Next advisories cleared; remaining highs are transitive build-toolchain (`sharp`/`postcss`/`brace-expansion`), not runtime-reachable on the public surface; `next/image` unused |
| Production build | **PASS** | En-only export fixed (`output: export` empty-params blocker); build:production emits `/`, `/for-clinics/`, `/privacy/`, `/terms/` only |
| Preflight guard | **PASS** | `check-launch.mjs` tested 3 modes; correctly NO-GOs on unprovisioned prod config + draft legal |
| Locale gate | **PASS** | Production = English only; no `/hi /te /ur`; sitemap/robots en-only; staging still emits drafts |
| Claims guard | **PASS** | `check:claims` green |
| Legal build guard | **PASS (correctly blocking)** | `check:legal` exits 1 on current markers — prevents a draft-legal production build |
| Accessibility | **PASS** | axe 0 violations × 4 routes; no regression |
| Performance (PERF-1) | **PASS** | Slow-4G LCP ~**770 ms** (H1 text, not media); CLS 0; First Load JS 104 KB |
| Stage-7 sharing | **PASS** | Share routes `private,no-store`+`noindex`+`DENY` live (staging+prod) |
| Rollback plan | **PASS** | Marketing rollback is Cloudflare-only; app/api/admin independent |

**Residual (non-blocking):** SEC-2 is fully addressed; SEC-3 build-time dependency highs accepted (resolve at next Next release / routine refresh); backup-purge + lead-retention enforcement carried as conditional P1 (see Layer 2).

## Layer 2 — Governance GO: **NO**

| Gate | State | Owner action |
|---|---|---|
| Registered legal entity | **P0 OPEN** | Supply name/type/CIN/address (Telangana known); do not infer |
| Counsel sign-off (OD-LP-6) | **OPEN** | Approve Privacy + Terms; choose governing law/venue |
| Public mailboxes (OD-LP-7) | **OPEN** | Provision + verify support@/privacy@/security@/partnerships@ |
| Erasure operator | **OPEN** | Name a responsible operator/role (mechanism ready) |
| English legal copy final | **OPEN** | Remove draft markers only on counsel sign-off |
| Backup ≤90-day purge (§62) | **P1 UNVERIFIED** | No R2 lifecycle-as-code / no prune in the backup job — enforce (R2 lifecycle rule or prune cron) **if** the privacy policy states it; else soften wording |
| Lead-retention 24-mo (§61) | **P1 not enforced** | Add `ProfessionalLead` cleanup **if** counsel requires it enforced at launch |

## Layer 3 — Production-Provisioning GO: **NOT STARTED** (by instruction)

| Item | State |
|---|---|
| Production Turnstile widget + secret | Not created (design in runbook §Phase 1a) |
| Production Web Analytics site + token | Not created (§Phase 1b) |
| Production API CORS (`medidocs.app`) | Staged in `railway.prod.ts`, **not applied** (§Phase 2) |
| Apex `medidocs.app` DNS / custom domain | Not attached (apex does not resolve) |
| `www` redirect | Not configured |

---

## Decision logic (§59)
- Engineering **GO** ✔ (after SEC-1 remediation, done this session).
- Governance **NO-GO** — hard P0 blockers remain (legal entity, counsel, mailboxes, erasure operator).
- Production-Provisioning **NOT STARTED** — deferred by the Session-16 boundary.

→ **Overall: NO-GO FOR CUTOVER — LAUNCH PLAN READY.** When the owner closes Layer 2 and authorizes Layer 3, Session 17 executes the runbook.

## Change-risk of the pending Session-17 actions (§68)
| Action | Risk |
|---|---|
| Production Web Analytics provisioning | LOW |
| Production Turnstile provisioning | LOW |
| Production API CORS add (`medidocs.app`) | LOW/MEDIUM (origin allow-list only; patient/admin unaffected) |
| Marketing Worker deploy (no apex) | LOW |
| Apex custom-domain attach | MEDIUM (public cutover; reversible by unbinding) |
| `www` redirect | LOW |
| Legal noindex/indexability enablement | MEDIUM (only after Privacy/Terms final) |
| Anything touching patient DB / auth / admin | HIGH — **out of scope**, not part of launch |
