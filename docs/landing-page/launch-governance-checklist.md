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
