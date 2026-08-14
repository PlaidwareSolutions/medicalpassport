# Launch Governance Checklist — medidocs.app (public marketing apex)

**Session 12 · updated Session 12.5 · 2026-08-13 · Controlling pre-launch gate list.**

This is the authoritative list of what must be true before `medidocs.app` can go public. States: **PASS** · **BLOCKED** · **PENDING OWNER** · **PENDING LEGAL** · **PENDING PRODUCTION PROVISIONING** · **N/A**. Sources: [privacy-data-inventory.md](privacy-data-inventory.md), [privacy-compliance-review.md](privacy-compliance-review.md), [privacy-and-grievance-operations.md](privacy-and-grievance-operations.md), [analytics-and-attribution.md](analytics-and-attribution.md), [stage7-sharing-security-review.md](stage7-sharing-security-review.md).

> Marketing staging (`staging.medidocs.app`) is fully live and verified (Sessions 6–11). Nothing below changes staging. Production apex is **not** launched.

## Legal
| Gate | State | Note |
|---|---|---|
| Operating legal entity identified & evidenced | **BLOCKED** | No entity resolved; `[LEGAL ENTITY TO BE CONFIRMED]` (inventory §0) |
| Privacy Policy finalized | **PENDING LEGAL** | Draft live on staging; counsel sign-off required (OD-LP-6) |
| Terms of Use finalized | **PENDING LEGAL** | Draft live on staging; counsel sign-off required |
| DPDP / applicable-law review | **PENDING LEGAL** | Commencement mapping **corrected** (compliance-review §2: Rule 4 at 1yr; SDF/cross-border at 18mo); role/notice/children still need counsel |
| Counsel sign-off documented | **PENDING LEGAL** | Hard launch gate; removes draft banner/placeholders |

## Operations
| Gate | State | Note |
|---|---|---|
| `support@` provisioned | **BLOCKED** | Owner **set** (primary `solutions@plaidware.com`, backup `kfnawaz@gmail.com`); Google Workspace; **EMAIL PROVISIONING — MANUAL ADMIN ACTION REQUIRED** (no MX; no admin tooling here) |
| `privacy@` (grievance) provisioned | **BLOCKED** | Owner set (same); manual admin provisioning pending |
| `security@` provisioned | **BLOCKED** | Owner set (same); manual admin provisioning pending |
| `partnerships@` provisioned | **BLOCKED** | Owner set (same); routes into existing lead flow |
| Primary + backup owners named | **PASS** | Primary `solutions@plaidware.com`; backup `kfnawaz@gmail.com` |
| Prove inbound + outbound mail before publishing addresses | **PENDING PRODUCTION PROVISIONING** | Publish no address until proven (SPEC §18) |

## Privacy / product
| Gate | State | Note |
|---|---|---|
| Data-principal rights workflow (access/correction/erasure/withdrawal) | **PENDING OWNER** | Erasure is now executable + tested; needs a named operator + written runbook step |
| Retention policy for core health data / documents / leads / backups | **PENDING LEGAL + ENG** | **Policy approved** + reconciled ([retention-and-erasure.md](retention-and-erasure.md)); counsel to confirm; lead-retention + backup-purge jobs deferred (small) |
| Children / guardian-consent approach | **PASS (V1) / PENDING LEGAL** | Policy approved; **V1 shipped** (PR #1, staging + prod); verifiable consent is future (Rule 10) — counsel to confirm adequacy |
| Account erasure capability or process | **PENDING OWNER** | **Executable mechanism implemented + synthetic-tested** (`apps/api/src/ops/account-erasure.ts`); needs named operator + runbook; self-service later |
| Consent + DPDP-style notice verified in app | **PENDING PRODUCT** | Ledger exists; notice unverified (review §4) |

## Security
| Gate | State | Note |
|---|---|---|
| Stage-7 sharing security review | **PASS** | Committed; verified (stage7 review) |
| Stage-7 F1 noindex + `private, no-store` on share/patient pages | **PASS** | Live-verified |
| Incident-response runbook | **PENDING OWNER** | Design in ops §4; owner + templates needed |
| Production Turnstile enforcing | **PENDING PRODUCTION PROVISIONING** | Prod widget/secret not created (deferred) |
| Security contact channel | **BLOCKED / PENDING OWNER** | Tied to `security@` |
| Security & claim-integrity audit (Session 15) | **PASS (marketing)** | [security-claims-audit.md](security-claims-audit.md): no P0; **no P1 on the marketing surface**. Strong CSP/headers; lead endpoint fail-closed + strict (rejects health data) + allowlist CORS (prod origin correctly un-applied); no secret/source-map exposure; first-party-only third-party footprint; **no share-token analytics leak**. Claim guard `check:claims` added to the deploy chain. |
| Framework patch — Next.js `15.5.21+` | **PENDING ENG (P1)** | SEC-1: patient app (`app.medidocs.app`) runs a Next server exposed to `<15.5.21` advisories (marketing static-export is **not** reachable). Bump + smoke before public launch. |

## Infrastructure (production — all deferred, documented only)
| Gate | State | Note |
|---|---|---|
| Production Turnstile widget + secret (`medidocs.app` only) | **PENDING PRODUCTION PROVISIONING** | Not created (SPEC §55) |
| Production Web Analytics site + token (separate from staging) | **PENDING PRODUCTION PROVISIONING** | Not created |
| Production API CORS (`https://medidocs.app`) applied | **PENDING PRODUCTION PROVISIONING** | Staged in `railway.prod.ts`, **not applied** |
| Apex `medidocs.app` DNS / custom domain | **PENDING PRODUCTION PROVISIONING** | No A/MX today (verified) |
| `www.medidocs.app` redirect | **PENDING PRODUCTION PROVISIONING** | Not configured |
| Production Cloudflare headers / CSP (analytics origins) | **PENDING PRODUCTION PROVISIONING** | Staging verified; prod not activated |
| Marketing assets (`assets.medidocs.app`) | **PASS** | Live (public marketing only) |

## Content
| Gate | State | Note |
|---|---|---|
| Clinical claim gate (Stage-6) | **PENDING** | Safety claims stay gated until clinical validation |
| Privacy/business claims (free, no-ads, no-sale) | **PENDING LEGAL** | **Business-approved** (ruling #6); bounded wording in drafts; publication gated on counsel |
| English content final | **PASS (staging)** | Homepage/for-clinics live; legal pages draft |
| Locale gates (hi/te/ur marketing) | **PENDING REVIEW** | Draft candidates live on staging (`/hi /te /ur`, noindexed, Session 13); **professional review required** before publishing; production stays **en-only** until REVIEWED. Non-English legal pages, video and audio remain deferred. |

## Launch execution
| Gate | State | Note |
|---|---|---|
| Accessibility (WCAG 2.2 AA target) + performance | **PASS** | Session 14 audit ([accessibility-performance-audit.md](accessibility-performance-audit.md)): 0 axe violations × 7 routes; CLS fixed to 0.00; target sizes ≥24px; focus-not-obscured hardened; RTL/reduced-motion/asset-failure verified. **No P0 a11y/perf blocker.** (Internal audit — not a public WCAG-conformance claim.) |
| Production static build (no draft placeholders) | **PENDING** | Build guard added (SPEC §57); passes only when placeholders resolved |
| Sitemap/robots for production (index Privacy/Terms only when approved) | **PENDING** | Staging stays noindex/disallow |
| Remove staging noindex — **N/A for staging** | **N/A** | Staging must stay noindexed |
| Live smoke test on apex | **PENDING PRODUCTION PROVISIONING** | Post-cutover |
| Rollback plan | **PENDING** | Define before cutover |

---

## Status after Session 12.5

**Potentially closable (policy/mechanism now in place; final sign-off aside):**
- Retention business policy (approved + reconciled).
- Erasure operational process (executable mechanism implemented + synthetic-tested).
- OD-LP-7 ownership model (primary/backup owners set).
- Child/dependent product policy (approved + V1 shipped).
- Business marketing commitments (business-approved).

**Still blocked (P0):**
1. **Registered legal entity** — TBD (Telangana/India known); owner to supply name/type/address ([legal-entity-decision.md](legal-entity-decision.md)).
2. **Counsel approval** of Privacy Policy + Terms (OD-LP-6) — packet ready ([legal-counsel-review-packet.md](legal-counsel-review-packet.md)).
3. **Public email provisioning** — `EMAIL PROVISIONING — MANUAL ADMIN ACTION REQUIRED` (Google Workspace, owners set); not provisioned; addresses unverified.
4. **Erasure runbook owner** — a named operator + written SOP step (mechanism exists).
5. Any child-product enforcement counsel deems necessary beyond V1.

**Production provisioning — still deferred (not performed):** production Turnstile, production Web Analytics, production CORS application, apex DNS, `www` redirect.

## Status after Session 15 (security & claim-integrity audit)

**Marketing surface is launch-clean on security and claims** ([security-claims-audit.md](security-claims-audit.md)): no P0, no P1 originating on the marketing site. Verified live — strong CSP with `frame-ancestors 'none'`, HSTS, host-scoped staging noindex; a fail-closed, strict, rate-limited lead endpoint that **cannot ingest health data** and enforces Turnstile; allowlist CORS with the **production apex origin correctly not yet authorized**; no committed secrets, no deployed source maps, no R2 directory listing; a first-party-only third-party footprint (Cloudflare Turnstile + Web Analytics + first-party R2) with **no share-token leak** to any tracker. Truth-first gating verified **at the emitted-HTML level** (clinical claims and the "never-sold" chip are absent, not hidden), with negative-capability disclaimers present and translation-parity-preserved. A new `check:claims` guard codifies these invariants in the deploy chain.

**New items surfaced (not launch-clean):**
1. **SEC-1 (P1, patient app):** bump `next` → `15.5.21+` and smoke `app.medidocs.app` before public launch (the running Next server is exposed to `<15.5.21` advisories; the static marketing export is not).
2. **SEC-2 (P2):** disable `x-powered-by` on the patient app + API (minor stack disclosure).

**Unchanged P0 launch blockers** (all non-engineering): registered legal entity, counsel sign-off (OD-LP-6), public email provisioning (OD-LP-7), erasure runbook owner, native-language review of hi/te/ur drafts.

## Status after Session 16 (production launch readiness & go/no-go)

**Engineering readiness: GO** (readiness, **not** launch). See [go-no-go.md](go-no-go.md) and [production-launch-runbook.md](production-launch-runbook.md).
- **SEC-1 PASS** — Next.js `15.5.20 → 15.5.21` across patient/admin/marketing; advisories cleared; deployed + live-verified on staging and prod.
- **SEC-2 PASS** — `x-powered-by` removed (patient + admin Next, API); live-verified absent staging + prod.
- **PERF-1 PASS** — Slow-4G LCP re-measured at ~770 ms (hero **H1 text**, not media); no optimization needed; CLS 0.
- **Production build** now deterministic and English-only (`build:production`); a latent `output: export` empty-locale-params blocker was fixed (prune of unpublished locale stubs). Not a Next 15.5.21 regression.
- **New guard** `check:launch` (production preflight): blocks staging test-keys / staging API / staging WA token / non-apex canonical / draft locales / uncleared legal in a production build.
- Accessibility 0 axe violations (no regression); Stage-7 sharing intact; claims/legal guards operating.

**New engineering items surfaced (P1/residual, not launch-clean):**
1. **Backup ≤90-day purge — UNVERIFIED / not enforced** (§62): daily encrypted `pg_dump → R2` runs, but there is no R2 lifecycle-as-code and the backup job does not prune. Enforce (R2 lifecycle rule or prune cron) **if** the published privacy policy asserts the 90-day window; otherwise soften wording. **No backups deleted.**
2. **Professional-lead 24-month retention — not enforced** (§61): no `ProfessionalLead` cleanup cron. Implement **if** counsel requires it enforced at launch; else deferred.
3. **SEC-3 build-time dependency highs** — transitive through `next` (`sharp`/`postcss`/`brace-expansion`); not runtime-reachable on the public surface; resolve at a routine refresh.

**Production provisioning — still deferred (not performed):** production Turnstile, production Web Analytics, production CORS application, apex DNS, `www` redirect. Runbook Phases 1–2 document each.

**Overall: NO-GO FOR CUTOVER — LAUNCH PLAN READY.** Governance P0s (legal entity, counsel, OD-LP-7 mailboxes, erasure operator, final English legal copy) remain the gate.

## Status after Session 17 (engineering completion & retention enforcement)

Owner re-sequencing: **finish all engineering first**; governance/provisioning follow. See [engineering-completion-ledger.md](engineering-completion-ledger.md).

- **Backup retention (90-day): TECHNICALLY ENFORCED + VERIFIED** — R2 lifecycle rule on the prod `…-backups` bucket (`postgres/` prefix, 90-day expiry), applied via the established `railway run` path and remotely re-read; idempotent `ensure-backup-lifecycle` cron added to IaC. Closes the Session-16 backup P1.
- **Professional-lead retention (24-month): implemented + tested** — `lastInteractionAt` migration (existing rows backfilled to `created_at`) + batched, idempotent, dry-run-capable `cleanup-professional-leads` cron. Closes the Session-16 lead-retention P1. (Truthful basis: 24 months from last recorded interaction = submission in V1; see [retention-and-erasure.md](retention-and-erasure.md).)
- **Marketing → app locale handoff: COMPLETE (dormant)** — `?lang=` allowlisted (en|hi|te|ur), stored-preference precedence, attribution-independent; production stays en-only.
- **Release engineering:** production preflight (`check:launch`) hardened; no stale TODOs / placeholder implementations / hardcoded staging creds on production paths; legal guard still correctly **BLOCKS**; `PUBLISHED_LOCALES = en` unchanged.

**No known landing-page-program engineering implementation gaps remain pending Session-18 validation.** Governance blockers (legal entity, counsel/OD-LP-6, OD-LP-7 mailboxes, erasure operator, native-language review) are **DEFERRED BY OWNER — do not block development**. Production provisioning (Turnstile/WA/CORS/apex/www) **NOT STARTED** by instruction.

## Status after Session 18 (final validation & RC freeze)

**ENGINEERING COMPLETE — RELEASE CANDIDATE FROZEN** (`medidocs-marketing-rc1`; see [release-candidate-manifest.md](release-candidate-manifest.md), [engineering-completion-ledger.md](engineering-completion-ledger.md)).

Full-system revalidation passed: typechecks 7/7; builds all pass; cron 13/13 + patient 21/21 unit tests; API 41 env-independent pass (e2e CI-validated); **axe 0 across all 7 routes** (after a minimal transform-only reveal-animation fix removing a transient `/ur` contrast false-positive); First Load JS 104 KB / CLS 0 / Slow-4G LCP ~770 ms; security clean (no committed secrets, next 15.5.21); backup lifecycle re-verified + fetch smoke; sharing analytics isolation clean (P0); CORS denies prod apex; guards **check-legal BLOCK** + **check-launch NO-GO** on governance/provisioning only.

**Remaining deployment-state item (non-blocking):** `cleanup-professional-leads` cron implemented + tested but **not yet operationally scheduled** — instantiating it needs a full prod IaC apply that would also apply the prohibited production marketing CORS, so it is deferred to the provisioning phase (nothing is deletable for 24 months). This is a deployment step, **not** an engineering gap.

**Overall: NO-GO FOR CUTOVER** until governance (legal entity, counsel, mailboxes, erasure operator, native-language review) and production provisioning (Turnstile/WA/CORS/apex/www) are cleared.

## Status after Session 19 (controlled production soft launch — authorized)

The owner authorized a **controlled production soft launch** (real apex infra, but global noindex, English-only, legal-draft retained) with governance continuing in parallel. See [production-soft-launch-report.md](production-soft-launch-report.md) and [go-no-go.md](go-no-go.md).

- **Soft-launch engineering: COMPLETE + verified** — `MARKETING_RELEASE_MODE=soft-launch`, `build:soft-launch`, `check:soft-launch` (production config + global noindex header/meta + crawlable-no-sitemap robots + empty sitemap + legal-still-draft). Production Worker config `wrangler.production.toml` added (separate from staging).
- **Final-launch gate PRESERVED** — `build:production` + `check:legal` still BLOCK (14 markers); no soft-launch noindex leaks into the indexable production build.
- **Cutover execution: ✅ LIVE (controlled soft launch).** `https://medidocs.app` is publicly reachable — production Worker + apex Custom Domain + valid TLS, **globally noindexed**, English-only, legal-draft retained. Verified: prod Turnstile (renders + fail-closed lead endpoint), prod Web Analytics (existing site; one beacon on marketing, zero on app/admin/share), production API CORS (apex authorized), retention crons scheduled, `/hi /te /ur` → 404, subdomains healthy, axe 0 violations, no tracker leakage, `check:legal` still BLOCKS. **Only remaining:** `www.medidocs.app` → apex 301 (Cloudflare Redirect Rule — dashboard; agent token has `zone:read` only; non-critical). See [production-soft-launch-report.md](production-soft-launch-report.md).
- **Safety findings:** `railway config plan` defaults to the **dev** config (would move the prod DB + set dev-fixed-OTP on prod) — always use `--file .railway/railway.prod.ts` (correct plan = CORS + 2 crons, 0 destroy); the two new cron services need `FIELD_ENCRYPTION_KEY` (+ R2 secrets for lifecycle) set after creation.

**Search indexability: OFF by design.** **Final public / indexed launch: NOT YET AUTHORIZED** (governance open).
